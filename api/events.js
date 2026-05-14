import { list, get } from '@vercel/blob';

const EVENT_PREFIX = 'events-v45/';

async function readJsonPath(pathname){
  const result = await get(pathname, { access:'private' });
  if(!result || result.statusCode !== 200) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
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
      sessions[id] = {id, appVersion:'v45', statsNamespace:'events-v45', startedAt:e.createdAt, events:[]};
    }

    const s = sessions[id];

    if(e.sessionSnapshot && typeof e.sessionSnapshot === 'object') Object.assign(s, e.sessionSnapshot);
    if(e.patch && typeof e.patch === 'object') Object.assign(s, e.patch);

    s.id = id;
    s.appVersion = e.appVersion || s.appVersion || 'v45';
    s.statsNamespace = 'events-v45';
    s.statsSeq = Math.max(Number(s.statsSeq || 0), Number(e.statsSeq || e.patch?.statsSeq || 0));
    s.updatedAt = e.createdAt || s.updatedAt;
    s.lastEventType = e.eventType || s.lastEventType;
    s.events.push({eventType:e.eventType, patch:e.patch || {}, createdAt:e.createdAt, statsSeq:e.statsSeq});

    if(e.eventType === 'start' && !s.startedAt) s.startedAt = e.createdAt;
    if(e.eventType === 'activities_complete') s.activitiesComplete = true;
    if(e.eventType === 'feedback_viewed') s.feedbackViewed = true;
    if(e.eventType === 'completed') s.conversationComplete = true;
    if(e.eventType === 'save_clicked') s.saveClicked = true;
  }
  return Object.values(sessions);
}

export default async function handler(req, res){
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
  try{
    let cursor = undefined;
    const blobs = [];
    do{
      const page = await list({prefix:EVENT_PREFIX, limit:1000, cursor});
      blobs.push(...(page.blobs || []));
      cursor = page.cursor;
    }while(cursor);

    const events = [];
    for(const b of blobs){
      try{
        const item = await readJsonPath(b.pathname);
        if(item) events.push(item);
      }catch(e){}
    }

    const sessions = mergeEventsIntoSessions(events);

    return res.status(200).json({
      ok:true,
      mode:'append-only',
      namespace:'events-v45',
      access:'private',
      count:sessions.length,
      eventCount:events.length,
      blobCount:blobs.length,
      sessions,
      events,
      generatedAt:new Date().toISOString()
    });
  }catch(error){
    return res.status(500).json({ok:false, error:error.message, sessions:[], events:[]});
  }
}
