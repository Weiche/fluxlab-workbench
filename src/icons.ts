const paths: Record<string, string> = {
  analysis: '<path d="M3 3v17h18M5 14l4-4 4 2 6-8"/>',
  batch:
    '<rect x="4" y="4" width="16" height="6" rx="1.4"/><path d="M4 14h16M4 18h16"/>',
  folder: '<path d="M3 8V5h6l2 3h9v11H3z"/>',
  save: '<path d="M4 4h13l3 3v13H4zM8 4v6h8V4M8 20v-7h8v7"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1.2-1.5 2.5M12 16h.01"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  sliders:
    '<path d="M4 7h5m4 0h7M4 17h10m4 0h2"/><circle cx="11" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/>',
  target:
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  motor:
    '<path d="M5 7h13v10H5zM2 10v4m18-4v4M8 4h7M8 20h7"/><path d="m8 14 2-4 2 4 2-4"/>',
  shield: '<path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6z"/>',
  model: '<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  export: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  torque:
    '<path d="M4 14a8 8 0 1 1 15 1M5 18h14M12 13l4-6"/><circle cx="12" cy="13" r="1.5"/>',
  wave: '<path d="M2 12h3c2 0 2-7 5-7s2 14 5 14 3-7 5-7h2"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7z"/>',
  speed: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l4 2"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/>',
  vector: '<path d="M4 4v16h16M7 16l9-10m-5 1 5-1v5"/>',
  expand: '<path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5"/>',
  table:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18m-18 5h18M10 9v11"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  file: '<path d="M5 3h9l5 5v13H5zM14 3v6h5"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  prev: '<path d="m16 5-8 7 8 7M5 5v14"/>',
  next: '<path d="m8 5 8 7-8 7M19 5v14"/>',
  pause: '<path d="M8 4v16m8-16v16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  activity: '<path d="M2 12h4l3-7 5 14 3-7h5"/>',
  link: '<path d="m9 15 6-6M8 13l-2 2a3 3 0 0 0 4 4l3-3m-2-8 3-3a3 3 0 0 1 4 4l-2 2"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
};
export function icon(name: string, size = 16) {
  return (
    '<svg aria-hidden="true" width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' +
    (paths[name] ?? "") +
    "</svg>"
  );
}
