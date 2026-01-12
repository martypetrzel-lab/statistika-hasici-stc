let chart;

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("cs-CZ");
}

async function apiGet(url) {
  const r = await fetch(url);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "API error");
  return j;
}

async function refreshAll() {
  const status = document.getElementById("status");
  status.textContent = "načítám…";

  const [inc, places] = await Promise.all([
    apiGet("/api/incidents?limit=80"),
    apiGet("/api/stats/places?limit=15")
  ]);

  document.getElementById("kpiInc").textContent = String(inc.rows.length);
  document.getElementById("kpiPlaces").textContent = String(places.data.length);

  const root = document.getElementById("incidents");
  root.innerHTML = "";
  for (const it of inc.rows) {
    const el = document.createElement("div");
    el.className = "item";

    const title = document.createElement("div");
    title.className = "itemTitle";
    title.textContent = it.title || "(bez názvu)";

    const meta = document.createElement("div");
    meta.className = "itemMeta";

    const m1 = document.createElement("span");
    m1.textContent = `📍 ${it.place || "neznámé místo"}`;

    const m2 = document.createElement("span");
    m2.textContent = `🕒 ${fmtDate(it.pub_date)}`;

    meta.appendChild(m1);
    meta.appendChild(m2);

    if (it.link) {
      const a = document.createElement("a");
      a.href = it.link;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = "detail";
      meta.appendChild(a);
    }

    el.appendChild(title);
    el.appendChild(meta);
    root.appendChild(el);
  }

  const labels = places.data.map((x) => x.place);
  const values = places.data.map((x) => x.count);

  const ctx = document.getElementById("chartPlaces");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Počet zásahů",
          data: values
        }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#cbd5e1" }, grid: { color: "rgba(255,255,255,0.06)" } },
        y: { ticks: { color: "#cbd5e1" }, grid: { color: "rgba(255,255,255,0.06)" } }
      }
    }
  });

  status.textContent = `OK – aktualizováno ${new Date().toLocaleTimeString("cs-CZ")}`;
}

async function ingestNow() {
  const status = document.getElementById("status");
  status.textContent = "spouštím ingest…";
  try {
    const r = await apiGet("/api/ingest");
    status.textContent = `Ingest OK – fetched=${r.fetched} upserted=${r.upserted}`;
    await refreshAll();
  } catch (e) {
    status.textContent = `Ingest FAIL: ${e?.message || e}`;
  }
}

document.getElementById("btnIngest").addEventListener("click", ingestNow);

refreshAll().catch((e) => {
  document.getElementById("status").textContent = `Chyba: ${e?.message || e}`;
});
