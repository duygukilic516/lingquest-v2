import { put, head } from '@vercel/blob';

const APP_STATS_VERSION = 'v35';
const PREFIX = 'sessions-v35/';

async function readJsonFromUrl(url){
  const res = await fetch(url, {cache:'no-store'});
  if(!res.ok) return null;
  return await res.json();
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
    const incomingSeq = Number(body.statsSeq ?? body.patch?.statsSeq ?? body.sessionSnapshot?.statsSeq ?? 0);
    const event = {
      sessionId,
      eventType: body.eventType || 'event',
      patch: body.patch || {},
      createdAt: new Date().toISOString(),
      statsSeq: incomingSeq,
      appVersion: body.statsVersion || APP_STATS_VERSION
    };

    const pathname = `${PREFIX}${sessionId}.json`;
    let current = null;
    try{
      const meta = await head(pathname);
      if(meta && meta.url) current = await readJsonFromUrl(meta.url);
    }catch(e){}

    const currentSeq = Number(current?.statsSeq || 0);

    // Ignore stale network writes. This prevents quick consecutive events from overwriting newer data.
    if(current && incomingSeq < currentSeq){
      return res.status(200).json({ok:true, sessionId, ignoredStale:true, currentSeq, incomingSeq});
    }

    const snapshot = body.sessionSnapshot && typeof body.sessionSnapshot === 'object' ? body.sessionSnapshot : {};
    const base = current || {id:sessionId, appVersion:APP_STATS_VERSION, statsNamespace:'sessions-v35', startedAt:event.createdAt, events:[]};
    const previousEvents = Array.isArray(base.events) ? base.events : [];
    const snapshotEvents = Array.isArray(snapshot.events) ? snapshot.events : [];
    const mergedEvents = previousEvents.concat(snapshotEvents.filter(e => Number(e.statsSeq || 0) > currentSeq), event).slice(-160);

    const session = Object.assign({}, base, snapshot, body.patch || {}, {
      id:sessionId,
      appVersion:event.appVersion || snapshot.appVersion || APP_STATS_VERSION,
      statsNamespace:'sessions-v35',
      statsSeq:incomingSeq || currentSeq,
      updatedAt:event.createdAt,
      lastEventType:event.eventType,
      events:mergedEvents
    });

    await put(pathname, JSON.stringify(session, null, 2), {
      access:'public',
      contentType:'application/json',
      allowOverwrite:true
    });

    return res.status(200).json({ok:true, sessionId, eventType:event.eventType, statsSeq:session.statsSeq});
  }catch(error){
    return res.status(500).json({ok:false, error:error.message});
  }
}
