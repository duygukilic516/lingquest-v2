import { list, get } from '@vercel/blob';

const EVENT_PREFIX = 'events-v45/';
const LEGACY_PREFIXES = ['sessions-v35/', 'sessions/'];

async function readJsonPath(pathname){
  const result = await get(pathname, { access:'private' });
  if(!result || result.statusCode !== 200) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

async function listAll(prefix){
  let cursor = undefined;
  const blobs = [];
  do{
    const page = await list({prefix, limit:1000, cursor});
    blobs.push(...(page.blobs || []));
    cursor = page.cursor;
  }while(cursor);
  return blobs;
}

function makeV43Compatible(session){
  return Object.assign({}, session, {
    appVersion:'v35',
    statsNamespace:'sessions-v35',
    appendOnlyNamespace: session.statsNamespace || 'events-v45'
  });
}

function mergeEventsIntoSessions(events){
  const sessions = {};
  const sorted = events.slice().sort((a,b)=>{
    const as = Number(a.statsSeq || a.patch?.statsSeq || 0);
    const bs = Number(b.statsSeq || b.patch?.statsSeq || 0);
    if(as !== bs) return as - bs;
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  });

  for(const e of sorted){
    const id = e.sessionId || e.sessionSnapshot?.id || e.patch?.id;
    if(!id) continue;

    if(!sessions[id]){
      sessions[id] = {id, appVersion:'v35', statsNamespace:'sessions-v35', appendOnlyNamespace:'events-v45', startedAt:e.createdAt, events:[]};
    }

    const s = sessions[id];

    if(e.sessionSnapshot && typeof e.sessionSnapshot === 'object') Object.assign(s, e.sessionSnapshot);
    if(e.patch && typeof e.patch === 'object') Object.assign(s, e.patch);

    s.id = id;
    s.appVersion = 'v35';
    s.statsNamespace = 'sessions-v35';
    s.appendOnlyNamespace = 'events-v45';
    s.statsSeq = Math.max(Number(s.statsSeq || 0), Number(e.statsSeq || e.patch?.statsSeq || 0));
    s.updatedAt = e.createdAt || s.updatedAt;
    s.lastEventType = e.eventType || s.lastEventType;
    s.events = Array.isArray(s.events) ? s.events : [];
    s.events.push({eventType:e.eventType, patch:e.patch || {}, createdAt:e.createdAt, statsSeq:e.statsSeq});

    if(e.eventType === 'start' && !s.startedAt) s.startedAt = e.createdAt;
    if(e.eventType === 'listening_complete') s.listeningComplete = true;
    if(e.eventType === 'activities_complete') s.activitiesComplete = true;
    if(e.eventType === 'speaking_started') s.conversationStarted = true;
    if(e.eventType === 'feedback_viewed') s.feedbackViewed = true;
    if(e.eventType === 'completed') s.conversationComplete = true;
    if(e.eventType === 'save_clicked') s.saveClicked = true;
  }
  return sessions;
}

function mergeLegacySession(target, legacy){
  if(!legacy || !legacy.id) return;
  const id = legacy.id;
  const existing = target[id] || {};
  const existingEvents = Array.isArray(existing.events) ? existing.events : [];
  const legacyEvents = Array.isArray(legacy.events) ? legacy.events : [];

  const merged = Object.assign({}, legacy, existing, {
    id,
    appVersion:'v35',
    statsNamespace:'sessions-v35',
    appendOnlyNamespace: existing.appendOnlyNamespace || legacy.appendOnlyNamespace || 'legacy',
    startedAt: existing.startedAt || legacy.startedAt,
    updatedAt: existing.updatedAt || legacy.updatedAt,
    lastEventType: existing.lastEventType || legacy.lastEventType,
    events: legacyEvents.concat(existingEvents)
  });

  // Preserve important true fields from either side.
  ['listeningStarted','listeningComplete','activitiesStarted','activitiesComplete','conversationStarted','conversationComplete','feedbackViewed','saveClicked'].forEach(k=>{
    merged[k] = !!(existing[k] || legacy[k]);
  });

  if(existing.activitySummary || legacy.activitySummary) merged.activitySummary = existing.activitySummary || legacy.activitySummary;
  if(existing.feedbackSummary || legacy.feedbackSummary) merged.feedbackSummary = existing.feedbackSummary || legacy.feedbackSummary;
  if(existing.savedAt || legacy.savedAt) merged.savedAt = existing.savedAt || legacy.savedAt;
  if(existing.completedAt || legacy.completedAt) merged.completedAt = existing.completedAt || legacy.completedAt;

  target[id] = merged;
}

export default async function handler(req, res){
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
  try{
    // New append-only events
    const eventBlobs = await listAll(EVENT_PREFIX);
    const events = [];
    for(const b of eventBlobs){
      try{
        const item = await readJsonPath(b.pathname);
        if(item) events.push(item);
      }catch(e){}
    }

    const sessionMap = mergeEventsIntoSessions(events);

    // Old v43/v35 snapshots
    const legacySessions = [];
    for(const prefix of LEGACY_PREFIXES){
      const legacyBlobs = await listAll(prefix);
      for(const b of legacyBlobs){
        try{
          const item = await readJsonPath(b.pathname);
          if(item && item.id) legacySessions.push(item);
        }catch(e){}
      }
    }

    legacySessions.forEach(s => mergeLegacySession(sessionMap, makeV43Compatible(s)));

    const sessions = Object.values(sessionMap).map(makeV43Compatible);
    const allEvents = sessions.flatMap(s => Array.isArray(s.events) ? s.events : []);

    return res.status(200).json({
      ok:true,
      mode:'append-only-v43-compatible-plus-legacy',
      namespace:'sessions-v35',
      appendOnlyNamespace:'events-v45',
      access:'private',
      count:sessions.length,
      eventCount:allEvents.length,
      blobCount:eventBlobs.length,
      legacyCount:legacySessions.length,
      sessions,
      events:allEvents,
      generatedAt:new Date().toISOString()
    });
  }catch(error){
    return res.status(500).json({ok:false, error:error.message, sessions:[], events:[]});
  }
}
