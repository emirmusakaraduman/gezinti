// GTFS beslemelerinin takvim geçerliliğini raporlar: servislerin başlangıç/bitiş
// tarihleri bugünü kapsıyor mu? Yönlendirici yalnızca haftanın gününe baktığı
// için süresi dolmuş bir besleme sessizce eski tarifeyi gösterir; bu betik onu görünür kılar.
//
//   node scripts/check-gtfs-validity.mjs
//
// Dosyaları değiştirmez; yalnızca data/gtfs/raw altındaki calendar.* dosyalarını okur.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const RAW = "data/gtfs/raw";
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");

/** Üst düzey klasörlerin altındaki GTFS dizinlerini (calendar.* içeren) bulur */
function feeds(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (!statSync(p).isDirectory()) continue;
    const files = readdirSync(p);
    if (files.some((f) => /^calendar(_dates)?\.(txt|csv)$/.test(f))) out.push(p);
    else out.push(...feeds(p));
  }
  return out;
}

const fmt = (d) => (d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "?");

/** CSV/; ayraçlı kaba okuma: başlıktan sütun bulur, tırnaksız alan varsayar */
function rows(file) {
  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const delim = head.split(";").length > head.split(",").length ? ";" : ",";
  const cols = head.split(delim).map((h) => h.trim());
  return lines.map((l) => {
    const f = l.split(delim);
    return Object.fromEntries(cols.map((c, i) => [c, (f[i] ?? "").trim()]));
  });
}

let expired = 0;
for (const dir of feeds(RAW)) {
  const cal = ["calendar.txt", "calendar.csv"].map((f) => path.join(dir, f)).find(existsSync);
  const dates = ["calendar_dates.txt", "calendar_dates.csv"].map((f) => path.join(dir, f)).find(existsSync);
  let start = "99999999";
  let end = "00000000";
  if (cal) {
    for (const r of rows(cal)) {
      if (r.start_date && r.start_date < start) start = r.start_date;
      if (r.end_date && r.end_date > end) end = r.end_date;
    }
  }
  if (dates) {
    for (const r of rows(dates)) {
      if (r.exception_type === "1" && r.date) {
        if (r.date < start) start = r.date;
        if (r.date > end) end = r.date;
      }
    }
  }
  if (end === "00000000") {
    console.log(`?   ${dir}: takvim tarihi okunamadı`);
    continue;
  }
  const ok = start <= TODAY && TODAY <= end;
  if (!ok) expired++;
  const note = ok ? "bugünü kapsıyor" : end < TODAY ? "SÜRESİ DOLMUŞ" : "henüz başlamamış";
  console.log(`${ok ? "ok " : "!!"}  ${dir}: ${fmt(start)} → ${fmt(end)}  ${note}`);
}
console.log(expired ? `\n${expired} besleme bugünü kapsamıyor` : "\nTüm beslemeler bugünü kapsıyor");
