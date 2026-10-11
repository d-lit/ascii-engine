import type { ParamInput, ParamSchema, ParamSpec, PointValue } from '../pipeline/params.ts';

const POINT_PRESETS = ['center', 'pointer'] as const;

function labelled(text: string, control: HTMLElement, extra?: HTMLElement): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'row';
  const caption = document.createElement('span');
  caption.textContent = text;
  caption.title = text;
  wrap.append(caption, control);
  if (extra) wrap.append(extra);
  return wrap;
}

function decimals(step: number): number {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

function control(
  key: string,
  spec: ParamSpec,
  values: Record<string, ParamInput>,
): HTMLLabelElement {
  const label = spec.label ?? key;
  const current = values[key];

  switch (spec.type) {
    case 'number': {
      const step = spec.step ?? (spec.max - spec.min) / 100;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(step);
      input.value = String(typeof current === 'number' ? current : spec.default);
      const out = document.createElement('output');
      const show = (): void => {
        out.textContent = Number(input.value).toFixed(decimals(step));
      };
      show();
      input.addEventListener('input', () => {
        values[key] = Number(input.value);
        show();
      });
      return labelled(label, input, out);
    }
    case 'boolean': {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = typeof current === 'boolean' ? current : spec.default;
      input.addEventListener('change', () => {
        values[key] = input.checked;
      });
      return labelled(label, input);
    }
    case 'select': {
      const node = document.createElement('select');
      const value = typeof current === 'string' ? current : spec.default;
      for (const o of spec.options) node.add(new Option(o, o, false, o === value));
      node.addEventListener('change', () => {
        values[key] = node.value;
      });
      return labelled(label, node);
    }
    case 'color': {
      const input = document.createElement('input');
      input.type = 'color';
      input.value = typeof current === 'string' ? current : spec.default;
      input.addEventListener('input', () => {
        values[key] = input.value;
      });
      return labelled(label, input);
    }
    case 'point': {
      // Free points are edited in phase 4; here only the two named anchors.
      const node = document.createElement('select');
      const value: PointValue = current === 'pointer' || current === 'center' ? current : spec.default;
      for (const o of POINT_PRESETS) node.add(new Option(o, o, false, o === value));
      node.addEventListener('change', () => {
        values[key] = node.value === 'pointer' ? 'pointer' : 'center';
      });
      return labelled(label, node);
    }
  }
}

/**
 * Controls generated from a param schema (invariant 6). They write straight
 * into `values`; the pipeline re-resolves them on the next frame.
 */
export function buildParamControls(
  schema: ParamSchema,
  values: Record<string, ParamInput>,
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'params';
  for (const key of Object.keys(schema)) box.append(control(key, schema[key]!, values));
  return box;
}
