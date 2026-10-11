# Спецификация движка

## 1. Цели и не-цели

**Цели**
- Оживлять готовое ASCII-полотно, полученное из изображения или текста.
- Эффекты как параметризуемые функции-пресеты, которые можно комбинировать в цепочку, сохранять и загружать в JSON.
- 2D, но выразительно: искажения, частицы, следы, интерактивность курсором.
- 60 fps на полотне до ~200×100 ячеек на среднем ноутбуке.

**Не-цели (пока)**
- 3D, WebGL-рендер (интерфейс рендера должен позволить добавить его позже).
- Генеративные программы без исходника (как в aiscii) — возможны как частный случай, но не цель.
- Экспорт видео (возможен в последней фазе).

## 2. Модель данных: Field

```ts
export type Polarity = 'light-on-dark' | 'dark-on-light';

export interface Field {
  readonly cols: number;
  readonly rows: number;
  lum: Float32Array;               // 0..1, яркость изображения (0 = чёрный)
  alpha: Float32Array;             // 0..1, 0 = фон/пустота
  color: Uint8ClampedArray | null; // RGB, length = cols*rows*3
  char: Uint16Array | null;        // авторские символы (charCode), 0 = нет
  gradX: Float32Array | null;      // Sobel по lum, считается при импорте
  gradY: Float32Array | null;
}

export interface FieldMeta {
  cellAspect: number;              // ширина/высота ячейки, ~0.5–0.6
  polarity: Polarity;
}
```

Индексация: `i = y * cols + x`. Источник (`source`) после импорта не меняется. Каждый кадр движок копирует его в рабочий буфер (`work`), который и модифицируют эффекты. Буферы выделяются один раз и переиспользуются; при смене размера — пересоздаются.

Рабочий буфер дополнительно содержит:
- `charOverride: Uint16Array` — символ, выставленный эффектом (0 = нет, выбирать по рампе);
- `sprites` — пул свободно позиционированных глифов для систем частиц (см. §6.3).

## 3. Импорт

### 3.1 Изображение → Field

Параметры импорта: `cols`, `cellAspect`, `brightness`, `contrast`, `gamma`, `invert`, `bgThreshold` (опционально).

1. Загрузить в `ImageBitmap`.
2. `rows = round(cols * (imgH / imgW) * cellAspect)`.
3. Даунскейл до `cols × rows` с усреднением по площади (не nearest). Допустимо: поэтапное уменьшение через canvas вдвое с `imageSmoothingQuality = 'high'`, либо ручное усреднение блоков.
4. `lum` = Rec.709 по sRGB-значениям (`0.2126 R + 0.7152 G + 0.0722 B`), затем levels: brightness / contrast / gamma, clamp 0..1.
5. `alpha` — из альфа-канала изображения. Если задан `bgThreshold`, вычисляется `cornerLum` — среднее `lum` четырёх угловых ячеек; ячейка получает `alpha = 0`, если `|lum - cornerLum| < bgThreshold`. Сравнение идёт по яркости, а не по RGB: `color` опционален и при импорте может отсутствовать.
6. `color` — средний RGB ячейки (опционально, флаг импорта).
7. `gradX/gradY` — оператор Собеля по `lum`.

### 3.2 Текст → Field

1. Нормализовать переводы строк в `\n`, табы в пробелы.
2. Разбить строки на графемы (`Intl.Segmenter`); одна графема = одна ячейка. Графемы длиннее одного code unit, широкие и одиночные комбинируемые/нулевой ширины символы заменить пробелом с предупреждением в консоль (список символов). См. DECISIONS 009.
3. Дополнить строки пробелами до максимальной длины (в графемах).
4. `char` = исходные символы.
5. `lum` — обратный поиск символа в рампе: плотность символа, затем учесть полярность (обратить, если `dark-on-light`). Символ не из рампы → измерить его обязательным параметром `measure: DensityMeasurer` (тот же механизм, что у `measureRamp`) и перевести на шкалу рампы через `normalizeDensity` (DECISIONS 008, 011). Импорт текста — вторая (вместе с квантователем) и последняя точка, где полярность имеет значение; см. инвариант 3 в `AGENTS.md`.
6. `alpha = 0` для пробелов, иначе 1.
7. Градиент — как в 3.1.

## 4. Рампа

```ts
export interface Ramp {
  chars: string;          // отсортировано по возрастанию плотности
  density: Float32Array;  // измеренная плотность каждого символа, нормирована 0..1
  rawMin: number;         // сырые плотности, ставшие 0 и 1 (DECISIONS 011)
  rawMax: number;
}

export type DensityMeasurer = (char: string) => number; // сырое покрытие 0..1
```

Сборка рампы разделена на две функции:

- `makeRamp(chars, density)` — чистая: отбрасывает дубликаты символов, сортирует пары (символ, плотность) по возрастанию плотности, нормирует плотности в 0..1 (min-max). Вся логика, которую можно проверить тестом, живёт здесь.
- `createDensityMeasurer(font)` — canvas-измеритель для шрифта, кэш по шрифту и символу. Размер ячейки в `font` — физические пиксели, тот же тайл, что рисует атлас; шрифт настраивается общей с атласом функцией `setupGlyphFont`.
- `normalizeDensity(ramp, raw)` — переводит сырую плотность на шкалу рампы с клампом в 0..1.
- `measureRamp(chars, font)` — рисует каждый символ на offscreen canvas размера ячейки, считает долю закрашенных пикселей (по альфе) и возвращает `makeRamp(chars, measured)`. Требует DOM, тестами не покрывается. Результат кэшируется по (chars, font). Плотность блочных символов (§9.3) берётся аналитически, а не измеряется.

Свойства `Ramp`:

- `chars` — всегда результат сортировки по измеренной плотности, а не входная строка: входная строка задаёт только *набор* символов. Порядок встроенных рамп подобран руками и обычно совпадает с измеренным, но расхождение — не ошибка.
- `density` нормируется min-max, то есть самый плотный символ рампы получает 1.0, самый пустой — 0.0, независимо от их физического покрытия. Иначе светлая часть диапазона яркости не отображалась бы ни на один символ (см. DECISIONS 006).
- Degenerate-случаи: рампа из одного символа — `density = [0]`; все плотности равны — все нули (нормировка не делит на ноль). Пустая строка — ошибка.

Квантование: `ink = polarity === 'light-on-dark' ? lum : 1 - lum`, затем выбор символа с ближайшей плотностью к `ink` (бинарный поиск по `density`). Это лучше равномерного `round(ink * (n - 1))`, потому что учитывает реальную неравномерность плотностей. Режим `uniform` оставить как опцию.

- Встроенные рампы: `blocks` (` ░▒▓█`), `classic` (` .:-=+*#%@`), `long` (~70 символов), `binary` (` 01`), `dots` (` .·•●`). Блочные символы рисуются процедурно (§9.3), их плотность задаётся аналитически.
- Рампа — глобальная настройка; переопределение рампы эффектом в маске — фаза 6.

## 5. Контекст кадра

```ts
export interface Pointer {
  x: number; y: number;     // в ячейках, дробные
  vx: number; vy: number;   // скорость, ячеек/с, сглаженная
  inside: boolean;
  down: boolean;
  clicked: boolean;         // true ровно в кадре нажатия
}

export interface FrameContext {
  time: number;             // секунды с начала
  dt: number;               // секунды, clamp до 1/20
  frame: number;
  cols: number; rows: number;
  cellAspect: number;
  pointer: Pointer;
  rand: () => number;       // сидированный PRNG, детерминированный
  source: Readonly<Field>;
}
```

Утилиты в `core/sample.ts`:
- `sampleLum(field, x, y)` — билинейно, координаты дробные, за краем — clamp (режим `wrap` опционален).
- `sampleAlpha`, `sampleColor` — аналогично.
- `distIso(dx, dy, cellAspect)` — расстояние с поправкой на соотношение сторон ячейки.

## 6. Эффекты

Общий дескриптор:

```ts
export type EffectKind = 'displace' | 'cell' | 'system';

export interface EffectDef<P extends Record<string, ParamSpec>> {
  id: string;               // 'ripple'
  name: string;             // 'Ripple'
  kind: EffectKind;
  params: P;
  create(params: ResolvedParams<P>): EffectInstance;
}
```

`params` в `create` — живой объект, который движок обновляет каждый кадр (значения уже разрешены из LFO и огибающих). Замыкания эффекта просто читают `params.speed`.

### 6.1 Displace

```ts
export interface Vec2 { x: number; y: number }
export type DisplaceFn = (x: number, y: number, ctx: FrameContext, out: Vec2) => void;
```

- `out` на входе содержит текущие координаты выборки (изначально `x, y` ячейки); функция их модифицирует. Цепочка displace-эффектов композиционна: каждый следующий получает результат предыдущего.
- После всех displace-эффектов движок делает выборку из `source` билинейно (`lum`, `alpha`, `color`) в рабочий буфер. Авторские `char` при смещении берутся nearest.

### 6.2 Cell

```ts
export interface CellRef {
  lum: number; alpha: number;
  r: number; g: number; b: number;
  char: number;             // 0 = выбрать по рампе
}
export type CellFn = (cell: CellRef, x: number, y: number, ctx: FrameContext) => void;
```

Движок использует один переиспользуемый `CellRef`: читает ячейку из буфера, вызывает по очереди все cell-функции, записывает обратно.

### 6.3 System

```ts
export interface SystemInstance {
  init(ctx: FrameContext, work: WorkBuffer): void;
  update(ctx: FrameContext): void;
  render(work: WorkBuffer, ctx: FrameContext): void;
  reset?(): void;
  dispose?(): void;
}
```

- Системы с состоянием: частицы, следы, осыпание.
- Пишут либо в сетку (`work.lum` и т. д.), либо в пул спрайтов `work.sprites` (свободные координаты, `char`, `lum`, `alpha`, цвет). Рендер рисует спрайты поверх сетки.
- Система может скрыть исходные ячейки, выставив им `alpha = 0` (например, частицы «забрали» символы из сетки).
- `init` вызывается при добавлении в цепочку и при смене источника.

### 6.4 Маска и смешивание

У каждого экземпляра эффекта в цепочке:
- `enabled: boolean`;
- `mix: ParamValue` (0..1, может быть LFO);
- `mask?: MaskSpec`:

```ts
export type MaskSpec =
  | { type: 'alpha'; invert?: boolean }
  | { type: 'lum'; min: number; max: number; soft?: number; invert?: boolean }
  | { type: 'radial'; center: PointValue; radius: ParamValue; soft?: number; invert?: boolean }
  | { type: 'rect'; x: number; y: number; w: number; h: number; soft?: number; invert?: boolean };
```

- Cell: `result = lerp(before, after, mix * mask)` по числовым полям; `char` применяется, если `mix * mask > 0.5`.
- Displace: смещение `(out - in)` масштабируется на `mix * mask`.
- System: маска передаётся в систему как подсказка (используется по усмотрению системы).

## 7. Параметры

```ts
export type ParamSpec =
  | { type: 'number'; min: number; max: number; step?: number; default: number; label?: string }
  | { type: 'boolean'; default: boolean; label?: string }
  | { type: 'select'; options: readonly string[]; default: string; label?: string }
  | { type: 'color'; default: string; label?: string }
  | { type: 'point'; default: PointValue; label?: string };

export type PointValue = { x: number; y: number } | 'pointer' | 'center'; // x, y нормированы 0..1

export type ParamValue =
  | number
  | { lfo: 'sine' | 'triangle' | 'saw' | 'square' | 'noise'; freq: number; min: number; max: number; phase?: number }
  | { env: Array<[t: number, v: number]>; loop?: boolean; ease?: 'linear' | 'smooth' };
```

- `pipeline/params.ts` разрешает `ParamValue → number` для текущего `time`. Огибающая `env` отсчитывается от момента активации эффекта.
- Значения за пределами `min/max` схемы клампятся при разрешении.
- `ResolvedParams<P>` — отображение схемы в обычные TS-типы (`number`, `boolean`, `string`, `{ x, y }` в ячейках), выводится из `P` на уровне типов.

## 8. Пресеты

```json
{
  "version": 1,
  "name": "Liquid portrait",
  "ramp": "classic",
  "polarity": "light-on-dark",
  "chain": [
    { "effect": "decode", "params": { "duration": 2.5 }, "mask": { "type": "alpha" } },
    {
      "effect": "ripple",
      "params": {
        "center": "pointer",
        "amplitude": { "lfo": "sine", "freq": 0.2, "min": 0.5, "max": 2 }
      },
      "mix": 1
    },
    { "effect": "trails", "params": { "decay": 0.9 } }
  ]
}
```

- Валидация при загрузке: неизвестный эффект → пропустить с предупреждением; неизвестный параметр → игнор; отсутствующий → default; неверный тип → default с предупреждением. Загрузка пресета никогда не бросает исключение наружу.
- Сохранение: текущая цепочка сериализуется обратно в этот формат (скачивание JSON).
- Встроенные пресеты лежат в `src/presets/*.json` и импортируются статически.

## 9. Рендер

```ts
export interface Renderer {
  resize(cols: number, rows: number, cellAspect: number): void;
  render(work: WorkBuffer, ramp: Ramp, meta: FieldMeta): void;
  dispose(): void;
}
```

### 9.1 Canvas 2D

- Размер ячейки — целые физические пиксели (`fitCell`): самая крупная ячейка, влезающая в контейнер, у которой `w/h` отличается от `cellAspect` не больше чем на 2%. CSS-размер canvas = физический / `devicePixelRatio`. Тема (фон и цвет символов) выбирается по полярности.
- Фон: цвет темы, одной заливкой. В режиме цветного фона ячеек — `fillRect` прогонами одинаковых цветов в строке.
- Символ ячейки разрешается по приоритету `charOverride → char → quantize(lum)`. Авторские `char` (из текстового импорта) учитываются только при включённом флаге `useSourceChars` — иначе смена рампы на текстовом источнике не давала бы никакого видимого результата. По умолчанию флаг включён.
- Ячейки с `alpha ≈ 0` или пустым символом пропускаются.
- Правило выбора символа живёт в одной функции `resolveCellChar` (`render/cell-char.ts`); её используют рендер и все экспортёры, чтобы вывод совпадал с экраном.
- `alpha` ячейки → `globalAlpha` при копировании тайла (или квантованные уровни, если так быстрее — мерить).

### 9.2 Атлас глифов

- Offscreen canvas, тайлы `cellW × cellH` в физических пикселях, по одному на символ.
- Ключ кэша атласа: `(font, cellW, cellH, dpr, color)`.
- Ленивое пополнение: новый символ (например, из decode) дорисовывается при первом появлении.
- Цвет: монохром — один атлас. Цветной режим — атласы по квантованной палитре (до 32 цветов), создаются лениво. Произвольный цвет на ячейку — задача будущего WebGL-рендера.

### 9.3 Процедурные блоки

Символы `░ ▒ ▓ █ ▀ ▄ ▌ ▐` рисуются в атлас не шрифтом, а прямоугольниками и узорами (тени — регулярная точечная маска плотностью 25%, 50%, 75%). Тайлы выровнены по целым пикселям, без щелей между ячейками. Оттенки зажигают ровно `round(d * w * h)` пикселей в порядке Bayer; фактическое покрытие любого блока на тайле `w × h` возвращает `blockGlyphDensity(code, w, h)`, и именно его использует измеритель (DECISIONS 010).

## 10. Цикл

- `requestAnimationFrame`, `dt` clamp до 1/20 с.
- Пауза при `document.hidden`.
- Порядок кадра: ввод → разрешение параметров → displace-выборка (или копия source→work) → cell → system.update/render → post → renderer.
- Debug-оверлей: fps, время кадра по стадиям (`performance.now()`), число спрайтов.

## 11. Ввод

- Pointer events на canvas, координаты переводятся в ячейки (дробные).
- Скорость курсора сглаживается экспоненциально.
- Touch работает так же, как мышь.

## 12. Бюджет производительности

- 200×100 ячеек: ≤ 6 мс CPU на кадр без систем частиц, ≤ 10 мс с частицами (все непустые ячейки).
- 0 аллокаций за кадр в установившемся режиме (проверка в DevTools Memory/Performance).
- Перед оптимизацией — замер. После — цифры до/после в отчёте.

## 13. Каталог эффектов (начальный)

**Cell**
- `wave` — синусоидальная волна по яркости (направление, длина, скорость, амплитуда).
- `erosion` — шумовой порог: ячейка гаснет, если `noise(x, y, t) < threshold`; порог анимируемый.
- `decode` — «расшифровка»: символы перебирают случайные варианты и фиксируются на правильном; фронт расходится от точки (`center`, `speed`, `scrambleSet`).
- `pulse` — пульсация яркости/контраста от точки или глобально.
- `posterize` — сокращение числа уровней яркости.
- `edge-glow` — подсветка по модулю градиента, бегущий «ток» по контурам.

**Displace**
- `ripple` — круговые волны от точки/курсора (амплитуда, длина волны, скорость, затухание).
- `swirl` — закручивание вокруг точки.
- `lens` — линза под курсором (увеличение/уменьшение).
- `liquid` — смещение потоком шума.
- `glitch-rows` — случайные горизонтальные сдвиги полос строк.
- `shake` — дрожание.

**System**
- `particles` — каждая непустая ячейка становится частицей с домашней позицией и пружиной; отталкивание курсором, взрыв по клику, сборка из хаоса на старте (`stiffness`, `damping`, `repelRadius`, `repelForce`, `explodeForce`, `intro`).
- `trails` — feedback: кадр смешивается с предыдущим с затуханием.
- `sand` — символы осыпаются под гравитацией и копятся (клеточный автомат), с возвратом по таймеру или клику.
