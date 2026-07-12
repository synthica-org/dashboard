// Shared 0-10 scale anchors so the pending intake and the onboarding wizard
// describe the numbers identically.
export const EXP_ANCHORS = [
  [0, 'Brand new — no projects yet'],
  [2, 'School science projects / class labs'],
  [4, 'Regional science fair or independent reading'],
  [6, 'Regional fair awards or a research club'],
  [7, 'Science fair at the state level'],
  [8, 'ISEF finalist or a selective summer program (e.g. SSP)'],
  [9, 'National competition awards or a preprint'],
  [10, 'Accepted to RSI or won ISEF / published in a journal'],
];

export const LEAD_ANCHORS = [
  [0, "I'd rather contribute than lead"],
  [2, 'Helped organize a club activity'],
  [4, 'Club officer or led a class group project'],
  [6, 'Led a club or team (5+ people)'],
  [7, 'Founded or ran a club or event'],
  [8, 'Led a large org or competition team'],
  [10, 'Founded & scaled an organization (20+ people)'],
];

export const anchorFor = (anchors, v) => {
  let label = anchors[0][1];
  for (const [n, l] of anchors) if (v >= n) label = l;
  return label;
};
