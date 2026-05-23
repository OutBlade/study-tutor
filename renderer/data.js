// BLADE Study Tutor — Static module data (KIT ETIT SS2026)
// PDFS, history, and quiz questions come from IPC at runtime.

const MODULES = [
  {
    id: 'iat-prak',
    code: 'IAT-P',
    name: 'IAT Praktikum',
    full: 'Industrielle Automatisierungstechnik — Praktikum',
    date: '2026-06-25',
  },
  {
    id: 'iat',
    code: 'IAT',
    name: 'IAT',
    full: 'Industrielle Automatisierungstechnik',
    date: '2026-07-08',
  },
  {
    id: 'hm2',
    code: 'HM II',
    name: 'HM II',
    full: 'Höhere Mathematik II',
    date: '2026-07-25',
  },
  {
    id: 'eet',
    code: 'EET',
    name: 'EET',
    full: 'Elektroenergietechnik',
    date: '2026-07-29',
  },
  {
    id: 'hm3',
    code: 'HM III',
    name: 'HM III',
    full: 'Höhere Mathematik III',
    date: '2026-08-08',
  },
  {
    id: 'es-ws',
    code: 'ES-W',
    name: 'ES Workshop',
    full: 'Eingebettete Systeme — Workshop',
    date: '2026-08-26',
  },
  {
    id: 'es',
    code: 'ES',
    name: 'ES',
    full: 'Eingebettete Systeme',
    date: '2026-09-08',
  },
];

window.BLADE_DATA = { MODULES };
