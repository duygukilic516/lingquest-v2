import { put, head, get } from '@vercel/blob';

const EVENT_VERSION = 'v45';
const FRONTEND_COMPAT_VERSION = 'v35';
const EVENT_PREFIX = 'events-v45/';
const LATEST_PREFIX = 'latest-v45/';
const LEGACY_PREFIX = 'sessions-v35/';

function safeName(value){
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

async function readJsonPath(pathname){
  const result = await get(pathname, { access:'private' });
  if(!result || result.statusCode !== 200) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Cache-Control','no-store');

  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method !== 'POST') return res.status(405).json({ok:false, error:'Method not allowed'});

  try{
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const sessionId = body.sessionId || body.sessionSnapshot?.id || `s_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const statsSeq = Number(body.statsSeq ?? body.patch?.statsSeq ?? body.sessionSnapshot?.statsSeq ?? 0);
    const eventType = body.eventType || 'event';
    const createdAt = new Date().toISOString();

    const event = {
      sessionId,
      eventType,
      statsSeq,
      createdAt,
      appVersion: body.statsVersion || FRONTEND_COMPAT_VERSION,
      statsNamespace: 'events-v45',
      patch: body.patch || {},
      sessionSnapshot: body.sessionSnapshot || null
    };

    // 1) Append-only source of truth: each action becomes its own file.
    const eventPath = `${EVENT_PREFIX}${safeName(sessionId)}/${String(statsSeq).padStart(6,'0')}-${Date.now()}-${safeName(eventType)}.json`;
    await put(eventPath, JSON.stringify(event, null, 2), {
      access:'private',
      contentType:'application/json',
      allowOverwrite:false
    });

    // 2) Latest snapshot for debugging and backward compatibility.
    const latest = Object.assign({}, body.sessionSnapshot || {}, body.patch || {}, {
      id: sessionId,
      appVersion: FRONTEND_COMPAT_VERSION,
      statsNamespace:'sessions-v35',
      appendOnlyNamespace:'events-v45',
      statsSeq,
      updatedAt: createdAt,
      lastEventType:eventType
    });

    await put(`${LATEST_PREFIX}${safeName(sessionId)}.json`, JSON.stringify(latest, null, 2), {
      access:'private',
      contentType:'application/json',
      allowOverwrite:true
    });

    // 3) v43 admin compatibility snapshot. This lets old admin.html display new sessions too.
    // It is NOT the source of truth; api/events reconstructs from append-only events.
    let previous = null;
    try{
      await head(`${LEGACY_PREFIX}${safeName(sessionId)}.json`);
      previous = await readJsonPath(`${LEGACY_PREFIX}${safeName(sessionId)}.json`);
    }catch(e){}

    const previousEvents = Array.isArray(previous?.events) ? previous.events : [];
    const compatSnapshot = Object.assign({}, previous || {}, latest, {
      id: sessionId,
      appVersion: FRONTEND_COMPAT_VERSION,
      statsNamespace:'sessions-v35',
      appendOnlyNamespace:'events-v45',
      startedAt: previous?.startedAt || latest.startedAt || createdAt,
      updatedAt: createdAt,
      lastEventType:eventType,
      events: previousEvents.concat([{eventType, patch:body.patch || {}, createdAt, statsSeq}]).slice(-160)
    });

    // Preserve important true fields from prior state or event type.
    if(previous?.listeningComplete || latest.listeningComplete) compatSnapshot.listeningComplete = true;
    if(previous?.activitiesComplete || latest.activitiesComplete || eventType === 'activities_complete') compatSnapshot.activitiesComplete = true;
    if(previous?.conversationComplete || latest.conversationComplete || eventType === 'completed') compatSnapshot.conversationComplete = true;
    if(previous?.feedbackViewed || latest.feedbackViewed || eventType === 'feedback_viewed') compatSnapshot.feedbackViewed = true;
    if(previous?.saveClicked || latest.saveClicked || eventType === 'save_clicked') compatSnapshot.saveClicked = true;

    await put(`${LEGACY_PREFIX}${safeName(sessionId)}.json`, JSON.stringify(compatSnapshot, null, 2), {
      access:'private',
      contentType:'application/json',
      allowOverwrite:true
    });

    return res.status(200).json({ok:true, mode:'append-only+v43-compatible', sessionId, eventType, statsSeq});
  }catch(error){
    return res.status(500).json({ok:false, error:error.message});
  }
}
