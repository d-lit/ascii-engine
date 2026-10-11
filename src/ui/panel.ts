import type { Polarity } from '../core/field.ts';
import type { RampName } from '../core/ramp.ts';
import type { AnyEffectDef } from '../effects/types.ts';
import { BUILTIN_PRESETS } from '../presets/builtin.ts';
import {
  applyChain,
  chainToPreset,
  parsePreset,
  serializePreset,
  validatePreset,
  type EffectLookup,
  type Preset,
} from '../presets/preset.ts';
import type { NumberSpec } from '../pipeline/params.ts';
import type { ChainEntry, Pipeline } from '../pipeline/pipeline.ts';
import { button, buildParamControls, checkbox, maskControl, numberControl, row } from './controls.ts';

export interface ViewSettings {
  ramp: RampName;
  polarity: Polarity;
}

/** What the chain panel needs from the app. */
export interface ChainPanelHost {
  readonly pipeline: Pipeline;
  readonly effects: readonly AnyEffectDef[];
  readonly lookup: EffectLookup;
  getView(): ViewSettings;
  setView(view: ViewSettings): void;
  status(message: string): void;
}

const MIX_SPEC: NumberSpec = { type: 'number', min: 0, max: 1, step: 0.01, default: 1 };
const KIND_ORDER = { displace: 0, cell: 1, system: 2 } as const;

/**
 * Presets and the effect chain (ROADMAP phase 4): add (repeats allowed),
 * remove, reorder, enable, mix, mask and params. Structural changes rebuild
 * the list; value edits write into the pipeline's entries in place.
 */
export class ChainPanel {
  private readonly host: ChainPanelHost;
  private readonly list = document.createElement('div');
  private readonly presetSelect = document.createElement('select');
  private readonly nameInput = document.createElement('input');
  private readonly open = new WeakSet<ChainEntry>();
  private readonly builtins: Preset[];

  constructor(root: HTMLElement, host: ChainPanelHost) {
    this.host = host;
    this.builtins = BUILTIN_PRESETS.map((raw) => validatePreset(raw, host.lookup).preset);
    this.list.className = 'chain';
    root.append(this.presetSection(), this.chainHeader(), this.list);
    this.render();
  }

  /** Applies a preset: view settings first, then the chain. */
  applyPreset(preset: Preset): void {
    this.host.setView({ ramp: preset.ramp, polarity: preset.polarity });
    applyChain(this.host.pipeline, preset.chain, this.host.lookup);
    this.nameInput.value = preset.name;
    this.render();
  }

  selectBuiltin(index: number): void {
    const preset = this.builtins[index];
    if (preset === undefined) return;
    this.presetSelect.value = String(index);
    this.applyPreset(preset);
  }

  // ---- presets ----

  private presetSection(): HTMLElement {
    const box = document.createElement('section');
    box.className = 'presets';
    const title = document.createElement('h3');
    title.textContent = 'preset';

    this.presetSelect.add(new Option('—', ''));
    this.builtins.forEach((p, i) => this.presetSelect.add(new Option(p.name, String(i))));
    this.presetSelect.addEventListener('change', () => {
      if (this.presetSelect.value !== '') this.selectBuiltin(Number(this.presetSelect.value));
    });

    this.nameInput.type = 'text';
    this.nameInput.value = 'Untitled';
    this.nameInput.placeholder = 'name';

    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.hidden = true;
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      file.value = '';
      if (f) void this.loadFile(f);
    });

    box.append(
      title,
      row('built-in', this.presetSelect),
      row('name', this.nameInput),
      row('file', button('load…', () => file.click()), button('save', () => this.save())),
      file,
    );
    return box;
  }

  private async loadFile(file: File): Promise<void> {
    const { preset, warnings } = parsePreset(await file.text(), this.host.lookup);
    for (const w of warnings) console.warn(`[preset] ${w}`);
    this.presetSelect.value = '';
    this.applyPreset(preset);
    this.host.status(
      warnings.length === 0
        ? `preset "${preset.name}" loaded`
        : `preset "${preset.name}" loaded with ${warnings.length} warning(s), see console`,
    );
  }

  private save(): void {
    const view = this.host.getView();
    const name = this.nameInput.value.trim() || 'Untitled';
    const json = serializePreset({
      version: 1,
      name,
      ramp: view.ramp,
      polarity: view.polarity,
      color: { mode: 'mono' },
      chain: chainToPreset(this.host.pipeline.chain),
    });
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.replace(/[^\w.-]+/g, '-').toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ---- chain ----

  private chainHeader(): HTMLElement {
    const box = document.createElement('section');
    box.className = 'chain-head';
    const title = document.createElement('h3');
    title.textContent = 'chain';

    const pick = document.createElement('select');
    const sorted = [...this.host.effects].sort(
      (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name),
    );
    for (const def of sorted) pick.add(new Option(`${def.name} · ${def.kind}`, def.id));

    const add = button('add', () => {
      const def = this.host.lookup(pick.value);
      if (def === undefined) return;
      const entry = this.host.pipeline.add(def, {});
      this.open.add(entry);
      this.render();
    });
    box.append(title, row('effect', pick, add));
    return box;
  }

  private render(): void {
    const chain = this.host.pipeline.chain;
    if (chain.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No effects. Pick one above or load a preset.';
      this.list.replaceChildren(empty);
      return;
    }
    this.list.replaceChildren(...chain.map((entry, i) => this.card(entry, i, chain.length)));
  }

  private card(entry: ChainEntry, index: number, count: number): HTMLElement {
    const { pipeline } = this.host;
    const card = document.createElement('div');
    card.className = 'fx';
    card.classList.toggle('off', !entry.enabled);

    const enable = checkbox(entry.enabled, (on) => {
      pipeline.setEnabled(entry, on);
      card.classList.toggle('off', !on);
    });
    enable.title = 'enabled';

    const name = button(entry.def.name, () => {
      if (this.open.has(entry)) this.open.delete(entry);
      else this.open.add(entry);
      body.hidden = !this.open.has(entry);
      card.classList.toggle('open', !body.hidden);
    });
    name.className = 'fx-name';

    const kind = document.createElement('span');
    kind.className = 'fx-kind';
    kind.textContent = entry.def.kind;

    const up = button('↑', () => this.move(entry, index - 1), 'move up');
    const down = button('↓', () => this.move(entry, index + 1), 'move down');
    up.disabled = index === 0;
    down.disabled = index === count - 1;
    const remove = button('✕', () => {
      pipeline.remove(entry);
      this.render();
    }, 'remove');

    const head = document.createElement('div');
    head.className = 'fx-head';
    head.append(enable, name, kind, up, down, remove);

    const body = document.createElement('div');
    body.className = 'fx-body';
    body.hidden = !this.open.has(entry);
    card.classList.toggle('open', !body.hidden);
    body.append(
      numberControl('mix', MIX_SPEC, () => entry.mix, (v) => {
        if (typeof v === 'number' || (typeof v === 'object' && !('x' in v))) entry.mix = v;
      }),
      maskControl(() => entry.mask, (m) => pipeline.setMask(entry, m)),
      buildParamControls(entry.def.params, entry.values),
    );

    card.append(head, body);
    return card;
  }

  private move(entry: ChainEntry, index: number): void {
    this.host.pipeline.move(entry, index);
    this.render();
  }
}
