/** The most of each part of a template. The platforms cut what is longer; these keep a template readable and bounded. */
export const TEMPLATE_LIMITS = {
  eyebrow: 80,
  title: 200,
  label: 40,
  summary: 300,
  freeText: 500,
  items: 24,
  freeTexts: 8,
  buttonLabel: 60,
  buttonUrl: 500,
  footer: 200,
  subject: 150,
  preheader: 200,
  note: 300,
  above: 1000,
} as const;
