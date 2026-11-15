(() => {
  'use strict';

  const MOBILE = window.matchMedia('(max-width: 600px)').matches;
  const CARD_W = MOBILE ? 260 : 220;
  const CHAMPION_W = 210;
  const SLOT_H = MOBILE ? 60 : 48;
  const SLOT_GAP = 8;
  const MATCH_H = SLOT_H * 2 + SLOT_GAP;
  const BAR_GAP = 18;
  const BADGE_OFFSET = 24;
  const COL = CARD_W + 110;
  const STAGE_W = COL * 2 + CHAMPION_W;
  const STAGE_H = MOBILE ? 270 : 250;

  const matches = {
    eliminator: { x: 0, y: 90 },
    final: { x: COL, y: 30 },
  };
  const routes = [
    { from: 'eliminator', to: 'final', bend: 18 },
    { from: 'final', to: 'champion', bend: 0 },
  ];

  const wrap = document.getElementById('playoffBracketWrap');
  const sizer = document.getElementById('playoffBracketSizer');
  const stage = document.getElementById('playoffBracketStage');
  if (!wrap || !sizer || !stage) return;

  stage.style.width = `${STAGE_W}px`;
  stage.style.height = `${STAGE_H}px`;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'lines');
  svg.setAttribute('width', String(STAGE_W));
  svg.setAttribute('height', String(STAGE_H));
  svg.setAttribute('aria-hidden', 'true');
  stage.prepend(svg);

  const addPath = (d, className = '') => {
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', d);
    if (className) path.setAttribute('class', className);
    svg.append(path);
  };

  Object.entries(matches).forEach(([id, match]) => {
    const element = stage.querySelector(`[data-match="${id}"]`);
    element.style.left = `${match.x}px`;
    element.style.top = `${match.y}px`;
  });
  const champion = stage.querySelector('.champion');
  champion.style.left = `${COL * 2}px`;
  champion.style.top = '0px';
  champion.style.top = `${matches.final.y + MATCH_H / 2 - champion.offsetHeight / 2}px`;

  const slotCenterY = (matchId, index) =>
    matches[matchId].y + index * (SLOT_H + SLOT_GAP) + SLOT_H / 2;

  Object.keys(matches).forEach((id) => {
    const match = matches[id];
    const x = match.x - BAR_GAP;
    const y0 = slotCenterY(id, 0);
    const y1 = slotCenterY(id, 1);
    addPath(`M${x} ${y0} V${y1} M${x} ${y0} H${match.x} M${x} ${y1} H${match.x}`);
  });

  Object.keys(matches).forEach((id) => {
    const match = matches[id];
    const element = stage.querySelector(`[data-match="${id}"]`);
    const slots = [...element.querySelectorAll('.slot')];
    const winner = element.dataset.winner;
    const right = match.x + CARD_W;
    const branch = right + BAR_GAP;
    const y0 = slotCenterY(id, 0);
    const y1 = slotCenterY(id, 1);
    addPath(`M${right} ${y0} H${branch} V${y1} H${right}`);

    if (winner) {
      const winnerIndex = slots.findIndex((slot) => slot.dataset.team === winner);
      if (winnerIndex !== -1) {
        addPath(`M${right} ${slotCenterY(id, winnerIndex)} H${branch}`, 'on-win');
        const loserIndex = 1 - winnerIndex;
        addPath(`M${right} ${slotCenterY(id, loserIndex)} H${branch}`, 'on-loss');
      }
    }
  });

  routes.forEach(({ from, to, bend }) => {
    const match = matches[from];
    const element = stage.querySelector(`[data-match="${from}"]`);
    const branch = match.x + CARD_W + BAR_GAP;
    const startY = match.y + MATCH_H / 2;
    const endX = to === 'champion' ? COL * 2 : matches[to].x - BAR_GAP;
    const endY = to === 'champion'
      ? champion.offsetTop + champion.offsetHeight / 2
      : matches[to].y + MATCH_H / 2;
    const midX = endX - bend;
    const path = startY === endY
      ? `M${branch} ${startY} H${endX}`
      : `M${branch} ${startY} H${midX} V${endY} H${endX}`;
    const decided = Boolean(element.dataset.winner);
    addPath(path, decided ? 'on-win' : '');

    const badge = document.createElement('span');
    badge.className = `badge w${decided ? ' active' : ''}`;
    badge.style.left = `${branch + BADGE_OFFSET}px`;
    badge.style.top = `${startY}px`;
    badge.textContent = 'W';
    badge.setAttribute('aria-hidden', 'true');
    stage.append(badge);
  });

  const fit = () => {
    const scale = Math.min(1, Math.max(0.6, wrap.clientWidth / STAGE_W));
    stage.style.transform = `scale(${scale})`;
    sizer.style.width = `${STAGE_W * scale}px`;
    sizer.style.height = `${STAGE_H * scale}px`;
  };

  window.addEventListener('resize', fit);
  fit();
})();
