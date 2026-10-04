export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.DB) {
      return new Response(JSON.stringify({ error: "D1 Database binding 'DB' not configured" }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const body = await request.json();
    const key = body.key || 'default';
    const doc = body.doc;
    if (!doc) {
      return new Response(JSON.stringify({ error: "Missing doc payload" }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const now = Date.now();
    const docStr = JSON.stringify(doc);

    // 1. Update sync_store
    await env.DB.prepare(
      'INSERT INTO sync_store (key, doc, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET doc=excluded.doc, updated_at=excluded.updated_at'
    ).bind(key, docStr, now).run();

    // 2. Sync profile
    if (doc.profile && typeof doc.profile === 'object') {
      const p = doc.profile;
      await env.DB.prepare(`
        INSERT INTO profile (id, height, weight, bf, birth, waist, base_steps, social, pal, start, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          height=excluded.height, weight=excluded.weight, bf=excluded.bf, birth=excluded.birth,
          waist=excluded.waist, base_steps=excluded.base_steps, social=excluded.social,
          pal=excluded.pal, start=excluded.start, updated_at=excluded.updated_at
      `).bind(
        key, p.height || null, p.weight || null, p.bf || null, p.birth || '',
        p.waist || null, p.baseSteps || 6000, p.social || 2.5, p.pal || 1.35,
        p.start || '2026-10-01', p.ts || now
      ).run();
    }

    // 3. Sync daily_records for structured SQL queries
    if (doc.days && typeof doc.days === 'object') {
      const stmts = [];
      for (const [dt, d] of Object.entries(doc.days)) {
        if (!d) continue;
        stmts.push(
          env.DB.prepare(`
            INSERT INTO daily_records (date, type, weight, bf, bmi, muscle_skeletal, visceral, water, heart_rate, steps, sleep, energy, kcal_b, kcal_l, kcal_d, kcal_s, note, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
              type=excluded.type, weight=excluded.weight, bf=excluded.bf, bmi=excluded.bmi,
              muscle_skeletal=excluded.muscle_skeletal, visceral=excluded.visceral, water=excluded.water,
              heart_rate=excluded.heart_rate, steps=excluded.steps, sleep=excluded.sleep,
              energy=excluded.energy, kcal_b=excluded.kcal_b, kcal_l=excluded.kcal_l,
              kcal_d=excluded.kcal_d, kcal_s=excluded.kcal_s, note=excluded.note,
              updated_at=excluded.updated_at
          `).bind(
            dt, d.type || 'normal', d.weight || null, d.bf || null, d.bmi || null,
            d.muscleSkeletal || null, d.visceral || null, d.water || null, d.heartRate || null,
            d.steps || null, d.sleep || null, d.energy || null,
            d.kcalB || null, d.kcalL || null, d.kcalD || null, d.kcalS || null,
            d.note || '', d.ts || now
          )
        );
      }
      if (stmts.length > 0) {
        await env.DB.batch(stmts);
      }
    }

    return new Response(JSON.stringify({ ok: true, ts: now }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
