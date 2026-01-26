const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const buildDefaultPreIcoWindow = () => {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, 1, 1, 23, 59, 59));
  return { start, end };
};

const STAGE_DEFS = [
  { key: 'pre_ico', label: 'Pre-ICO', startEnv: 'ICO_PRE_START', endEnv: 'ICO_PRE_END' },
  { key: 'ico', label: 'ICO', startEnv: 'ICO_STAGE_ICO_START', endEnv: 'ICO_STAGE_ICO_END' },
  { key: 'stage_1', label: 'Stage 1', startEnv: 'ICO_STAGE1_START', endEnv: 'ICO_STAGE1_END' },
  { key: 'stage_2', label: 'Stage 2', startEnv: 'ICO_STAGE2_START', endEnv: 'ICO_STAGE2_END' },
];

const resolveStages = (now = new Date()) => {
  const durationDays = Number(process.env.ICO_STAGE_DURATION_DAYS || 30);
  const preDefaults = buildDefaultPreIcoWindow();

  const stages = STAGE_DEFS.map((stage) => {
    const start =
      parseDate(process.env[stage.startEnv]) ||
      (stage.key === 'pre_ico' ? preDefaults.start : null);
    const end =
      parseDate(process.env[stage.endEnv]) ||
      (stage.key === 'pre_ico' ? preDefaults.end : null);
    return {
      ...stage,
      startAt: start,
      endAt: end,
    };
  });

  for (let i = 1; i < stages.length; i += 1) {
    if (!stages[i].startAt && stages[i - 1].endAt) {
      stages[i].startAt = addDays(stages[i - 1].endAt, 1);
    }
  }

  for (let i = 0; i < stages.length; i += 1) {
    const isLast = i === stages.length - 1;
    if (stages[i].startAt && !stages[i].endAt && durationDays > 0 && !isLast) {
      stages[i].endAt = addDays(stages[i].startAt, durationDays);
    }
  }

  const enriched = stages.map((stage) => {
    const startAt = stage.startAt;
    const endAt = stage.endAt;
    const isUpcoming = Boolean(startAt && now < startAt);
    const isEnded = Boolean(endAt && now > endAt);
    const isActive = !isUpcoming && !isEnded && (startAt || endAt);
    const status = isActive ? 'active' : isUpcoming ? 'upcoming' : isEnded ? 'ended' : 'inactive';
    return {
      key: stage.key,
      label: stage.label,
      startAt,
      endAt,
      status,
      isActive,
      isUpcoming,
      isEnded,
    };
  });

  const activeStage = enriched.find((stage) => stage.isActive) || enriched[0];
  return { stages: enriched, activeStage };
};

const isSellAllowed = (stageKey) => {
  const sellEnabled = process.env.ICO_SELL_ENABLED
    ? process.env.ICO_SELL_ENABLED === 'true'
    : true;
  if (!sellEnabled) return false;
  return stageKey !== 'pre_ico';
};

module.exports = {
  resolveStages,
  isSellAllowed,
};
