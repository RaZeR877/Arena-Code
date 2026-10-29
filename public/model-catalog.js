/* Model choices are derived from the models the loaded WebLLM runtime actually advertises.
   No made-up model IDs; no automatic large downloads. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArenaModelCatalog = api;
})(typeof globalThis === 'undefined' ? null : globalThis, function () {
  'use strict';
  function sizeBillions(id) {
    const match = String(id).match(/(?:^|[-_])(0\.5|1\.5|3|4|7|8|9|12|14|27|32)B(?:[-_]|$)/i);
    return match ? Number(match[1]) : null;
  }
  function availableModels(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list.filter(record => {
      const id = record && record.model_id;
      if (typeof id !== 'string' || !id || seen.has(id) || !/instruct/i.test(id) || !/q4f16/i.test(id)) return false;
      seen.add(id);
      return true;
    }).map(record => {
      const id = record.model_id, size = sizeBillions(id), coding = /coder|codegemma|starcoder|deepseek-coder/i.test(id);
      const tier = size === null ? 'Unknown hardware needs' : size <= 1.5 ? 'Lighter hardware' : size <= 4 ? 'More GPU memory needed' : 'High GPU memory; often unavailable on phones';
      return { id, size, coding, tier, label: `${coding ? 'Coding' : 'General'} · ${id.replace(/-q4f16.*$/i, '')} · ${tier}` };
    }).sort((a, b) => {
      const as = a.size ?? 100, bs = b.size ?? 100;
      return as - bs || Number(b.coding) - Number(a.coding) || a.id.localeCompare(b.id);
    });
  }
  function recommended(list, stored) {
    if (stored && list.some(m => m.id === stored)) return stored;
    const near = (size, coder) => list.find(m => m.size === size && m.coding === coder);
    return (near(1.5, true) || near(0.5, true) || near(1.5, false) || near(0.5, false) || list[0])?.id || null;
  }
  return Object.freeze({ sizeBillions, availableModels, recommended });
});
