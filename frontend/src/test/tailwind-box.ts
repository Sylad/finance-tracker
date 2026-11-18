// L174 — mesure de la boîte cliquable d'un élément à partir de ses classes Tailwind.
// jsdom ne calcule aucune mise en page (getBoundingClientRect rend 0) : on recompose la boîte
// comme le navigateur, avec les valeurs du thème RÉSOLU (tailwind.config.ts), pour les seules
// classes que nos cibles utilisent — p/px/py, m/mx/my (négatives comprises), h/w/min-h/min-w,
// hauteur de ligne de la taille de texte et taille de l'icône contenue. Une classe d'espacement
// ou de taille non reconnue fait échouer la mesure plutôt que de la fausser.
import resolveConfig from 'tailwindcss/resolveConfig';
import tailwindConfig from '../../tailwind.config';

const theme = resolveConfig(tailwindConfig).theme as unknown as {
  spacing: Record<string, string>;
  fontSize: Record<string, [string, { lineHeight: string }]>;
};

const ROOT_PX = 16;

function px(value: string): number {
  if (value === '0px' || value === '0') return 0;
  const m = /^(-?[\d.]+)(rem|px)$/.exec(value);
  if (!m) throw new Error(`valeur Tailwind non mesurable : ${value}`);
  return Number(m[1]) * (m[2] === 'rem' ? ROOT_PX : 1);
}

function space(key: string): number {
  const v = theme.spacing[key];
  if (v === undefined) throw new Error(`pas d'espacement Tailwind « ${key} »`);
  return px(v);
}

export interface Box {
  /** zone cliquable : contenu + padding (ou h/w imposés, min-h/min-w) */
  width: number;
  height: number;
  /** place occupée dans la mise en page : zone cliquable + marges, négatives comprises */
  layoutWidth: number;
  layoutHeight: number;
}

function classes(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

/** Taille du contenu : l'icône SVG seule (h-N w-N), sinon la hauteur de ligne du texte. */
function content(el: Element): { width: number; height: number } {
  const svg = el.querySelector('svg');
  if (svg && el.textContent?.trim() === '') {
    let w = NaN;
    let h = NaN;
    for (const c of classes(svg)) {
      const m = /^([hw])-(.+)$/.exec(c);
      if (m && m[1] === 'h') h = space(m[2]);
      if (m && m[1] === 'w') w = space(m[2]);
    }
    if (Number.isNaN(w) || Number.isNaN(h)) throw new Error('icône sans h-/w- Tailwind');
    return { width: w, height: h };
  }
  // Texte : hauteur de ligne de la classe text-<taille> de l'élément ou du plus proche ancêtre ;
  // la largeur d'un texte n'est pas mesurable sans mise en page (NaN).
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    for (const c of classes(cur)) {
      const m = /^text-(xs|sm|base|lg|xl)$/.exec(c);
      if (m) return { width: NaN, height: px(theme.fontSize[m[1]][1].lineHeight) };
    }
  }
  throw new Error('taille de texte introuvable');
}

export function tailwindBox(el: Element): Box {
  const pad = { t: 0, r: 0, b: 0, l: 0 };
  const mar = { t: 0, r: 0, b: 0, l: 0 };
  let height: number | undefined;
  let width: number | undefined;
  let minH = 0;
  let minW = 0;
  for (const c of classes(el)) {
    let m: RegExpExecArray | null;
    if ((m = /^p([xy]?)-(.+)$/.exec(c))) {
      const v = space(m[2]);
      if (m[1] !== 'x') pad.t = pad.b = v;
      if (m[1] !== 'y') pad.l = pad.r = v;
    } else if ((m = /^(-?)m([xy]?)-(.+)$/.exec(c))) {
      const v = (m[1] ? -1 : 1) * space(m[3]);
      if (m[2] !== 'x') mar.t = mar.b = v;
      if (m[2] !== 'y') mar.l = mar.r = v;
    } else if ((m = /^min-([hw])-(.+)$/.exec(c))) {
      if (m[1] === 'h') minH = space(m[2]);
      else minW = space(m[2]);
    } else if ((m = /^([hw])-(.+)$/.exec(c))) {
      if (m[1] === 'h') height = space(m[2]);
      else width = space(m[2]);
    } else if (/^(p[trbl]|-?m[trbl]|size)-/.test(c)) {
      throw new Error(`classe non prise en charge par la mesure : ${c}`);
    }
  }
  const inner = content(el);
  const h = Math.max(height ?? inner.height + pad.t + pad.b, minH);
  const w = Math.max(width ?? inner.width + pad.l + pad.r, minW);
  return { width: w, height: h, layoutWidth: w + mar.l + mar.r, layoutHeight: h + mar.t + mar.b };
}
