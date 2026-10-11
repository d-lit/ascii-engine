# 003 — Экспорт кадра в текст

**Статус:** ready
**Фаза:** 6 (взята раньше: зависит только от готового рендера фазы 1)
**Автор постановки:** Claude
**Исполнитель:** —

## Контекст

Пользователь хочет сохранить текущую картинку как обычный ASCII-текст: скачать `.txt` или скопировать в буфер обмена. Символ каждой ячейки уже определяет `resolveCellChar` (`src/render/cell-char.ts`). Это то же правило, по которому рисует `Canvas2DRenderer` (SPEC §9.1, DECISIONS 007), поэтому экспорт совпадает с экраном по построению. Свою логику выбора символа не писать.

Спрайты систем частиц (фаза 5) в экспорт не входят: их пока нет. Это будет отдельное решение, когда они появятся.

## Что сделать

1. Создать чистую функцию `exportText` в `src/render/export-text.ts`:
   - обходит ячейки построчно, `i = y * cols + x`;
   - символ ячейки: `resolveCellChar(work, i, ramp, polarity, opts.useSourceChars, opts.quantizeMode)`; результат `0` превращается в пробел `' '`;
   - собирает строки через `String.fromCharCode`;
   - при `opts.trimRight === true` удаляет пробелы в конце каждой строки (только U+0020). Пустые строки остаются: число строк результата всегда равно `rows`;
   - строки соединяются через `'\n'`, в конце результата один `'\n'`.
   Функция не горячая (вызывается по кнопке), аллокации допустимы.
2. Тесты в `tests/render/export-text.test.ts`.
3. UI в `src/main.ts`:
   - завести на уровне модуля `let ramp: Ramp | null = null;` и присваивать его в `redraw()` вместо локальной `const ramp` (переименовать локальную или присвоить в модульную, чтобы не было затенения);
   - функция `currentText(): string | null` — `null`, если `source`, `work` или `ramp` ещё нет; иначе `exportText(work, ramp, settings.polarity, { useSourceChars: settings.useSourceChars, quantizeMode: settings.quantizeMode, trimRight: settings.trimRight })`;
   - в `Settings` добавить `trimRight: boolean` (по умолчанию `true`) и checkbox-строку `trim` — по образцу строки `source chars`, но видимую всегда. Перерисовка при её смене не нужна;
   - две кнопки в одной строке `export`: `copy` и `save .txt`:
     - `copy` → `navigator.clipboard.writeText(text)`; статус `copied N lines` или `copy failed: <сообщение>` (ошибку ловить, `console.error`);
     - `save .txt` → `Blob` с типом `text/plain;charset=utf-8`, временная ссылка `<a download>`, имя файла — имя источника без расширения + `.txt` (для `art.txt` получится `art.txt`, для `photo.jpg` — `photo.txt`), после клика `URL.revokeObjectURL`;
     - до загрузки источника обе кнопки `disabled`; включать в `load()` после успешной загрузки.
4. Стили кнопок в `src/style.css` в стиле существующих правил `#panel` (тёмный фон `--panel-bg`, рамка `--border`, текст `--fg`, моноширинный шрифт наследуется), `disabled` — цвет `--muted`.

## Файлы

Создать:
- `src/render/export-text.ts`
- `tests/render/export-text.test.ts`

Изменить:
- `src/main.ts` — только то, что перечислено в п. 3
- `src/style.css` — стили кнопок

Не трогать: всё остальное, в том числе `cell-char.ts`, `canvas2d.ts`, SPEC, DECISIONS, ROADMAP.

## Интерфейсы

```ts
// src/render/export-text.ts
import type { Polarity, WorkBuffer } from '../core/field.ts';
import type { QuantizeMode, Ramp } from '../core/ramp.ts';

export interface TextExportOptions {
  useSourceChars: boolean;
  quantizeMode: QuantizeMode;
  trimRight: boolean;
}

export function exportText(
  work: WorkBuffer,
  ramp: Ramp,
  polarity: Polarity,
  opts: TextExportOptions,
): string;
```

Используется готовое: `resolveCellChar` из `src/render/cell-char.ts`.

## Образец

- Функция и тест — как `src/render/cell-char.ts` и `tests/render/cell-char.test.ts` (там же образец сборки `WorkBuffer` в тесте через `createWorkBuffer` и `makeRamp`).
- Строки панели — как `source chars` и `quantize` в `src/main.ts` (helper `row`).

## Критерии приёмки

- [ ] Тест: поле 3×2 с известными `lum` и рампой `makeRamp(' .@', [0, 0.5, 1])` даёт ожидаемый текст, включая финальный `'\n'`.
- [ ] Тест: прозрачная ячейка (`alpha = 0`) экспортируется пробелом, даже если у неё есть `charOverride`.
- [ ] Тест: `trimRight` убирает хвостовые пробелы, но сохраняет полностью пустую строку (число `'\n'` = `rows`).
- [ ] Тест: `useSourceChars: false` заменяет авторский `char` на символ рампы; `charOverride` выигрывает в обоих режимах.
- [ ] Тест: `dark-on-light` инвертирует выбор символа относительно `light-on-dark` на одном и том же поле.
- [ ] Тест-согласованность: для каждой ячейки символ в результате равен `resolveCellChar(...)` или пробелу, если тот вернул 0.
- [ ] В браузере: загрузить фото, `save .txt`, открыть файл в моноширинном редакторе — картинка та же, что на экране (рампа, полярность учтены).
- [ ] В браузере: `copy` и вставка в редактор дают тот же текст; при `trim` выключенном все строки одной длины.
- [ ] В браузере: до загрузки файла кнопки неактивны; консоль без ошибок.
- [ ] `npm run check` проходит.

## Вне рамок

- Спрайты систем частиц, цвет, экспорт в HTML/ANSI.
- Изменение правила выбора символа и `resolveCellChar`.
- Горячие клавиши, экспорт анимации (последовательности кадров).
- Любые изменения SPEC/DECISIONS/ROADMAP — если что-то в постановке противоречит коду, записать вопрос в `docs/OPEN-QUESTIONS.md` и перевести задачу в `blocked`.

---

## Отчёт исполнителя

_Заполняет исполнитель._

## Ревью

_Заполняет архитектор: принято / замечания._
