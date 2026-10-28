// Momo's Imagine endpoint accepts URL references in prompt, not file/base64 uploads.
export function getMidjourneyInputs() {
  const field = (key, label, type, extra = {}) => ({ key, label, name: label, type, required: false, group: 'advanced', ...extra });
  const number = (key, label, min, max, step = 1, hint = '') => field(key, label, 'number', { min, max, step, hint: hint || `${min}–${max}；留空沿用提示词或模型默认值` });
  return [
    field('mjMainImage', '主图 · 内容与构图', 'image-url', { group: 'references', hint: '可选。粘贴可公开访问的图片直链；不填则为文生图。主图会放在提示词开头。' }),
    field('mjReferenceImages', '参考图', 'image-url', { group: 'references', multiple: true, hint: '可选。每行一个图片直链，可添加多张。请在下方选择参考用途。' }),
    field('mjReferenceRole', '参考图用途', 'select', { group: 'references', default: 'image', options: [{ value: 'image', label: '内容 / 构图（Image Prompt）' }, { value: 'style', label: '风格参考（--sref）' }], hint: 'V8.2 通过图片 URL 提交内容参考；风格参考使用 --sref，并可调节 --sw。角色参考不属于 momo 当前开放的 Imagine 参数。' }),
    number('mjImageWeight', '主图 / 内容参考权重 --iw', 0, 3, 0.1),
    number('mjStyleWeight', '风格参考权重 --sw', 0, 1000),
    field('mjAspectRatio', '画幅比例 --ar', 'select', { group: 'basic', default: '', options: [{ value: '', label: '沿用提示词 / 模型默认' }, '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2', { value: '__custom__', label: '自定义比例' }], allowCustom: true, customKey: 'mjAspectRatioCustom', customPlaceholder: '正整数比例，例如 5:4' }),
    field('mjRaw', 'Raw · 减少自动美化', 'checkbox', { group: 'basic', hint: '启用后添加 --style raw。留空参数不会覆盖手写提示词。' }),
    field('mjHd', 'HD / 2K', 'checkbox', { group: 'basic', hint: '添加 --hd；可能产生 HD 附加费用，支持范围取决于版本和渠道。' }),
    number('mjStylize', '风格化 --stylize', 0, 1000),
    number('mjChaos', '多样性 --chaos', 0, 100),
    number('mjWeird', '怪诞程度 --weird', 0, 3000),
    number('mjSeed', '随机种子 --seed', 0, 4294967295),
    field('mjNo', '排除元素 --no', 'text', { group: 'advanced', placeholder: 'text, watermark, logo', hint: '使用逗号分隔；影响生成倾向，不保证完全排除。' }),
    field('mjProfile', '个人化 Profile', 'text', { placeholder: '你的 Profile ID', hint: '添加 --profile；需要渠道有权使用的 Profile。' }),
    field('mjTile', '无缝平铺 --tile', 'checkbox', { group: 'advanced', hint: '适用于纹理、壁纸等连续图案。' })
  ];
}

export function parseMidjourneyImageUrls(value, label = '参考图') {
  const text = String(value ?? '').trim();
  if (!text) return [];
  const urls = text.split(/\s+/);
  return [...new Set(urls.map((value) => {
    let url;
    try { url = new URL(value); } catch (_) { throw new Error(`${label}需要完整的 http(s) 图片直链`); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(url.hostname)) {
      throw new Error(`${label}需要公开可访问的 http(s) 图片直链，不能使用本地路径或 Base64`);
    }
    return value;
  }))];
}

function getPromptParameters(prompt) {
  const aliases = { v: 'version', version: 'version', niji: 'version', ar: 'aspect', aspect: 'aspect', s: 'stylize', stylize: 'stylize', c: 'chaos', chaos: 'chaos', w: 'weird', weird: 'weird', q: 'quality', quality: 'quality', raw: 'raw', style: 'raw', p: 'profile', profile: 'profile', personalize: 'profile' };
  const result = new Map();
  const regex = /(?:^|\s)--([a-z][a-z0-9-]*)(?:\s+([\s\S]*?))?(?=\s+--[a-z]|$)/gi;
  for (const match of prompt.matchAll(regex)) {
    const key = aliases[match[1].toLowerCase()] || match[1].toLowerCase();
    if (['sref', 'cref', 'oref'].includes(key)) {
      if (result.has(key)) throw new Error(`提示词中存在重复参数 --${match[1]}，请保留一个`);
      result.set(key, String(match[2] || '').trim());
      continue;
    }
    if (result.has(key)) throw new Error(`提示词中存在重复参数 --${match[1]}，请保留一个`);
    result.set(key, String(match[2] || '').trim());
  }
  return result;
}

export function buildMidjourneyPrompt(inputs = {}) {
  const prompt = String(inputs.prompt || '').trim();
  if (!prompt) throw new Error('请填写 Midjourney 提示词');
  const params = getPromptParameters(prompt);
  if (['fast', 'relax', 'turbo'].some((key) => params.has(key))) throw new Error('请使用队列模式选择 Fast / Relax，不要在提示词中添加速度参数');
  const main = parseMidjourneyImageUrls(inputs.mjMainImage, '主图');
  if (main.length > 1) throw new Error('主图只能填写一张，其他图片请添加到参考图');
  const refs = parseMidjourneyImageUrls(inputs.mjReferenceImages);
  const role = String(inputs.mjReferenceRole || 'image');
  if (!['image', 'style'].includes(role)) throw new Error('请选择有效的参考图用途');
  const suffix = [];
  const add = (key, flag, value) => {
    if (value === '' || value == null || value === false) return;
    if (params.has(key)) throw new Error(`提示词已包含 --${flag}，请清空对应表单参数或删除手写参数，避免重复`);
    suffix.push(`--${flag}${value === true ? '' : ` ${value}`}`);
    params.set(key, value === true ? '' : String(value));
  };
  const promptVersion = String(params.get('version') || '');
  if (promptVersion && promptVersion !== '8.2') throw new Error('当前 momo Imagine 工作台仅支持 V8.2，请移除提示词中的其他版本参数');
  const effectiveVersion = '8.2';
  const ratio = String(inputs.mjAspectRatio || '').trim() === '__custom__' ? String(inputs.mjAspectRatioCustom || '').trim() : String(inputs.mjAspectRatio || '').trim();
  if (ratio && !/^[1-9]\d*:[1-9]\d*$/.test(ratio)) throw new Error('画幅比例应为正整数比例，例如 16:9');
  add('aspect', 'ar', ratio);
  add('raw', 'style', inputs.mjRaw === true ? 'raw' : '');
  add('hd', 'hd', inputs.mjHd === true);
  for (const [key, flag] of [['mjStylize', 'stylize'], ['mjChaos', 'chaos'], ['mjWeird', 'weird'], ['mjSeed', 'seed'], ['mjImageWeight', 'iw'], ['mjStyleWeight', 'sw']]) {
    const raw = inputs[key];
    if (raw == null || String(raw).trim() === '') continue;
    const meta = getMidjourneyInputs().find((item) => item.key === key);
    const value = Number(raw);
    const maximum = meta.max;
    if (!Number.isFinite(value) || value < meta.min || value > maximum || (meta.step === 1 && !Number.isInteger(value))) throw new Error(`${meta.label}应为 ${meta.min}–${maximum}${meta.step === 1 ? ' 的整数' : ' 的数字'}`);
    add(flag, flag, value);
  }
  if (!promptVersion) add('version', 'v', '8.2');
  for (const [key, flag] of [['mjNo', 'no'], ['mjProfile', 'profile']]) {
    const value = String(inputs[key] || '').trim();
    if (/(?:^|\s)--/.test(value)) throw new Error(`${flag} 字段中不能填写其他控制参数`);
    add(flag, flag, value);
  }
  add('tile', 'tile', inputs.mjTile === true);
  if (refs.length && role === 'style') add('sref', 'sref', refs.join(' '));
  const imageUrls = [...new Set([...main, ...(role === 'image' ? refs : [])])];
  if (params.has('iw') && !imageUrls.length && !/^https?:\/\//i.test(prompt)) throw new Error('图片权重 --iw 需要主图或内容参考图');
  if (params.has('sw') && !params.has('sref')) throw new Error('风格权重 --sw 需要风格参考图');
  if (params.has('cref') || params.has('cw') || params.has('oref') || params.has('ow')) throw new Error('当前 momo Imagine 工作台只开放 V8.2 内容 / 风格参考，不支持旧版角色参考参数');
  if (params.has('stop')) throw new Error('V8.2 不支持 --stop');
  if (params.has('quality')) throw new Error('V8.2 不支持 --quality');
  return [...imageUrls, prompt, ...suffix].join(' ');
}
