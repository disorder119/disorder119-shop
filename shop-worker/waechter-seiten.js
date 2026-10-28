import { ERWISCHT_A, ERWISCHT_B, ERWISCHT_BASIS, ERWISCHT_C, V } from "./waechter-erwischt-texte.js";

// Seiten des Waechters fuer disorder119.com (storefront-edge.js):
//
// 1. "Erwischt"-Bildschirm: NUR fuer die Anfrage, die selbst ein eindeutiges
//    Angriffsmuster traegt (SQL-Injection, XSS, Path-Traversal, Log4Shell,
//    Angriffs-Programm), und fuer Scanner-Pfade, sobald der Anschluss deshalb
//    gesperrt ist. Optik "Gegen-Hack" (Terminal, Tippen, Glitch), Inhalt
//    wahr: angezeigt wird nur, was der Server ohnehin weiss (IP aus
//    CF-Connecting-IP - nur angezeigt, nie gespeichert -, Netz, Ort,
//    Geraet, Uhrzeit, Angriffsart, die blockierte Anfrage, Vorfall-Nummer).
//    Keine erfundenen Dateien, keine Drohungen, kein Download, kein Skript.
//    Sprache nach Land (cf.country), Englisch immer zusaetzlich.
// 2. Neutrale Sperrseite: fuer alle anderen Anfragen eines gesperrten
//    Anschlusses (auch unbeteiligte Kunden hinter derselben Adresse), auf
//    Deutsch, Englisch und Franzoesisch, mit Impressum und - wo erlaubt -
//    Selbst-Entsperrung per Cloudflare Turnstile.
//
// Alles, was aus der Anfrage stammt, ist Angreifer-Text und wird hier
// HTML-maskiert (esc), von Steuer- und Richtungszeichen befreit und gekuerzt.
// Es landet nur als Text zwischen Tags oder in Attributen mit Anfuehrungs-
// zeichen, nie in Skript, Stil oder URL. Stile nur per CSP-Hash.

// Oeffentlicher Turnstile-Site-Key - derselbe wie config/shop-config.json
// "turnstileSiteKey" (Test in waechter-seiten.test.mjs haelt beide gleich).
export const TURNSTILE_SITE_KEY = "0x4AAAAAAFHqI2j_AitAYIKF";
export const ENTSPERREN_PFAD = "/_waechter/entsperren";
export const VORSCHAU_PFAD = "/_waechter/vorschau";

const STEUERZEICHEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
// Richtungs- und unsichtbare Formatzeichen (RTL-Override & Co.): koennten die
// Anzeige umdrehen oder Text verstecken - entfernt.
const FORMATZEICHEN = /[؜​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

export function esc(wert) {
  return String(wert ?? "").replace(/[&<>"']/g, z => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[z]));
}

// Text aus der Anfrage: Steuerzeichen sichtbar, Formatzeichen weg, gekuerzt
// nach Zeichen (nicht Bytes), danach erst maskieren.
export function anzeigeText(wert, max = 120) {
  const sauber = String(wert ?? "").replace(/[\r\n\t]/g, " ").replace(STEUERZEICHEN, "·").replace(FORMATZEICHEN, "");
  const zeichen = Array.from(sauber);
  return esc(zeichen.length > max ? `${zeichen.slice(0, max - 1).join("")}…` : sauber);
}

export function nutzlastText(pfadMitQuery, max = 140) {
  let text = String(pfadMitQuery ?? "");
  try { text = decodeURIComponent(text.replace(/\+/g, " ")); } catch {}
  return anzeigeText(text, max);
}

// Geraet und Browser aus der Kennung - ohne Versionswirrwarr.
export function geraetText(ua) {
  const text = String(ua || "").trim();
  if (!text) return "—";
  if (!/^Mozilla\//.test(text)) return text.split(/\s+/)[0].slice(0, 48);
  const system = /Windows NT/.test(text) ? "Windows" : /Android/.test(text) ? "Android" : /iPhone|iPad|iPod/.test(text) ? "iOS"
    : /CrOS/.test(text) ? "ChromeOS" : /Mac OS X|Macintosh/.test(text) ? "macOS" : /Linux/.test(text) ? "Linux" : "";
  const browser = [[/Edg(?:e|A|iOS)?\/(\d+)/, "Edge"], [/OPR\/(\d+)/, "Opera"], [/SamsungBrowser\/(\d+)/, "Samsung Internet"],
    [/Firefox\/(\d+)/, "Firefox"], [/FxiOS\/(\d+)/, "Firefox"], [/CriOS\/(\d+)/, "Chrome"], [/Chrome\/(\d+)/, "Chrome"], [/Version\/(\d+)[\d.]* .*Safari\//, "Safari"]]
    .map(([muster, name]) => { const t = muster.exec(text); return t ? `${name} ${t[1]}` : null; }).find(Boolean) || "";
  return [system, browser].filter(Boolean).join(" · ") || text.split(/\s+/)[0].slice(0, 48);
}

// Angriffsart - technische Begriffe sind international.
const ART_NAME = Object.freeze({
  "sql-injection": "SQL injection",
  "xss": "Cross-site scripting (XSS)",
  "path-traversal": "Path traversal (../)",
  "log4shell": "Log4Shell (JNDI)",
  "angriffs-programm": "Attack tool",
  "scanner-pfad": "Vulnerability scan",
});

// ---------------------------------------------------------------- Sprachen

// Schluessel: titel, satz, text, verfolgen, netz, ort, geraet, zeit, art, anfrage, nr
const T = {
  en: ["ATTACK DETECTED", "I know you're trying to hack me.", "Your attack was blocked and logged. This connection is blocked.", "Tracing connection", "Network", "Location", "Device", "Time", "Attack", "Blocked request", "Incident no."],
  de: ["ANGRIFF ERKANNT", "Ich weiß, dass du versuchst, mich zu hacken.", "Dein Angriff wurde blockiert und protokolliert. Dieser Anschluss ist gesperrt.", "Verbindung wird zurückverfolgt", "Netz", "Standort", "Gerät", "Zeit", "Angriff", "Blockierte Anfrage", "Vorfall-Nr."],
  fr: ["ATTAQUE DÉTECTÉE", "Je sais que tu essaies de me pirater.", "Ton attaque a été bloquée et enregistrée. Cette connexion est bloquée.", "Traçage de la connexion", "Réseau", "Localisation", "Appareil", "Heure", "Attaque", "Requête bloquée", "N° d'incident"],
  es: ["ATAQUE DETECTADO", "Sé que estás intentando hackearme.", "Tu ataque ha sido bloqueado y registrado. Esta conexión está bloqueada.", "Rastreando la conexión", "Red", "Ubicación", "Dispositivo", "Hora", "Ataque", "Solicitud bloqueada", "N.º de incidente"],
  it: ["ATTACCO RILEVATO", "So che stai cercando di hackerarmi.", "Il tuo attacco è stato bloccato e registrato. Questa connessione è bloccata.", "Tracciamento della connessione", "Rete", "Posizione", "Dispositivo", "Ora", "Attacco", "Richiesta bloccata", "N. incidente"],
  pt: ["ATAQUE DETECTADO", "Eu sei que você está tentando me hackear.", "Seu ataque foi bloqueado e registrado. Esta conexão está bloqueada.", "Rastreando a conexão", "Rede", "Localização", "Dispositivo", "Hora", "Ataque", "Solicitação bloqueada", "Nº do incidente"],
  nl: ["AANVAL GEDETECTEERD", "Ik weet dat je me probeert te hacken.", "Je aanval is geblokkeerd en vastgelegd. Deze verbinding is geblokkeerd.", "Verbinding wordt getraceerd", "Netwerk", "Locatie", "Apparaat", "Tijd", "Aanval", "Geblokkeerd verzoek", "Incidentnr."],
  pl: ["WYKRYTO ATAK", "Wiem, że próbujesz mnie zhakować.", "Twój atak został zablokowany i zarejestrowany. To połączenie jest zablokowane.", "Śledzenie połączenia", "Sieć", "Lokalizacja", "Urządzenie", "Czas", "Atak", "Zablokowane żądanie", "Nr incydentu"],
  cs: ["ÚTOK ODHALEN", "Vím, že se mě snažíš hacknout.", "Tvůj útok byl zablokován a zaznamenán. Toto připojení je zablokováno.", "Sledování připojení", "Síť", "Poloha", "Zařízení", "Čas", "Útok", "Zablokovaný požadavek", "Č. incidentu"],
  sk: ["ÚTOK ODHALENÝ", "Viem, že sa ma snažíš hacknúť.", "Tvoj útok bol zablokovaný a zaznamenaný. Toto pripojenie je zablokované.", "Sledovanie pripojenia", "Sieť", "Poloha", "Zariadenie", "Čas", "Útok", "Zablokovaná požiadavka", "Č. incidentu"],
  ro: ["ATAC DETECTAT", "Știu că încerci să mă hackuiești.", "Atacul tău a fost blocat și înregistrat. Această conexiune este blocată.", "Se urmărește conexiunea", "Rețea", "Locație", "Dispozitiv", "Ora", "Atac", "Cerere blocată", "Nr. incident"],
  hu: ["TÁMADÁS ÉSZLELVE", "Tudom, hogy meg akarsz hackelni.", "A támadásodat blokkoltuk és naplóztuk. Ez a kapcsolat le van tiltva.", "Kapcsolat visszakövetése", "Hálózat", "Hely", "Eszköz", "Idő", "Támadás", "Blokkolt kérés", "Incidens száma"],
  el: ["ΕΝΤΟΠΙΣΤΗΚΕ ΕΠΙΘΕΣΗ", "Ξέρω ότι προσπαθείς να με χακάρεις.", "Η επίθεσή σου μπλοκαρίστηκε και καταγράφηκε. Αυτή η σύνδεση είναι αποκλεισμένη.", "Ανίχνευση σύνδεσης", "Δίκτυο", "Τοποθεσία", "Συσκευή", "Ώρα", "Επίθεση", "Αποκλεισμένο αίτημα", "Αρ. συμβάντος"],
  bg: ["ОТКРИТА АТАКА", "Знам, че се опитваш да ме хакнеш.", "Атаката ти беше блокирана и записана. Тази връзка е блокирана.", "Проследяване на връзката", "Мрежа", "Местоположение", "Устройство", "Час", "Атака", "Блокирана заявка", "№ на инцидент"],
  hr: ["OTKRIVEN NAPAD", "Znam da me pokušavaš hakirati.", "Tvoj napad je blokiran i zabilježen. Ova veza je blokirana.", "Praćenje veze", "Mreža", "Lokacija", "Uređaj", "Vrijeme", "Napad", "Blokirani zahtjev", "Br. incidenta"],
  sv: ["ATTACK UPPTÄCKT", "Jag vet att du försöker hacka mig.", "Din attack har blockerats och loggats. Den här anslutningen är spärrad.", "Spårar anslutningen", "Nätverk", "Plats", "Enhet", "Tid", "Attack", "Blockerad begäran", "Incidentnr"],
  da: ["ANGREB OPDAGET", "Jeg ved, at du prøver at hacke mig.", "Dit angreb er blevet blokeret og logget. Denne forbindelse er spærret.", "Sporer forbindelsen", "Netværk", "Placering", "Enhed", "Tid", "Angreb", "Blokeret anmodning", "Hændelsesnr."],
  nb: ["ANGREP OPPDAGET", "Jeg vet at du prøver å hacke meg.", "Angrepet ditt er blokkert og logget. Denne tilkoblingen er sperret.", "Sporer tilkoblingen", "Nettverk", "Plassering", "Enhet", "Tid", "Angrep", "Blokkert forespørsel", "Hendelsesnr."],
  fi: ["HYÖKKÄYS HAVAITTU", "Tiedän, että yrität hakkeroida minut.", "Hyökkäyksesi estettiin ja kirjattiin. Tämä yhteys on estetty.", "Jäljitetään yhteyttä", "Verkko", "Sijainti", "Laite", "Aika", "Hyökkäys", "Estetty pyyntö", "Tapausnro"],
  ru: ["АТАКА ОБНАРУЖЕНА", "Я знаю, что ты пытаешься меня взломать.", "Твоя атака заблокирована и зарегистрирована. Это подключение заблокировано.", "Отслеживание подключения", "Сеть", "Местоположение", "Устройство", "Время", "Атака", "Заблокированный запрос", "№ инцидента"],
  uk: ["АТАКУ ВИЯВЛЕНО", "Я знаю, що ти намагаєшся мене зламати.", "Твою атаку заблоковано та зареєстровано. Це підключення заблоковано.", "Відстеження підключення", "Мережа", "Розташування", "Пристрій", "Час", "Атака", "Заблокований запит", "№ інциденту"],
  tr: ["SALDIRI TESPİT EDİLDİ", "Beni hacklemeye çalıştığını biliyorum.", "Saldırın engellendi ve kayda alındı. Bu bağlantı engellendi.", "Bağlantı izleniyor", "Ağ", "Konum", "Cihaz", "Saat", "Saldırı", "Engellenen istek", "Olay no."],
  ar: ["تم اكتشاف هجوم", "أعلم أنك تحاول اختراقي.", "تم حظر هجومك وتسجيله. هذا الاتصال محظور.", "جارٍ تتبّع الاتصال", "الشبكة", "الموقع", "الجهاز", "الوقت", "الهجوم", "الطلب المحظور", "رقم الحادثة"],
  he: ["זוהתה מתקפה", "אני יודע שאתה מנסה לפרוץ אליי.", "המתקפה שלך נחסמה ונרשמה. החיבור הזה חסום.", "מאתר את החיבור", "רשת", "מיקום", "מכשיר", "שעה", "מתקפה", "בקשה חסומה", "מס׳ אירוע"],
  fa: ["حمله شناسایی شد", "می‌دانم که می‌خواهی مرا هک کنی.", "حملهٔ تو مسدود و ثبت شد. این اتصال مسدود است.", "در حال ردیابی اتصال", "شبکه", "مکان", "دستگاه", "زمان", "حمله", "درخواست مسدودشده", "شمارهٔ رویداد"],
  ur: ["حملہ پکڑا گیا", "مجھے معلوم ہے کہ تم مجھے ہیک کرنے کی کوشش کر رہے ہو۔", "تمہارا حملہ روک دیا گیا اور درج کر لیا گیا ہے۔ یہ کنکشن بلاک ہے۔", "کنکشن کا سراغ لگایا جا رہا ہے", "نیٹ ورک", "مقام", "ڈیوائس", "وقت", "حملہ", "روکی گئی درخواست", "واقعہ نمبر"],
  hi: ["हमला पकड़ा गया", "मुझे पता है कि तुम मुझे हैक करने की कोशिश कर रहे हो।", "तुम्हारा हमला रोक दिया गया है और दर्ज कर लिया गया है। यह कनेक्शन ब्लॉक है।", "कनेक्शन का पता लगाया जा रहा है", "नेटवर्क", "स्थान", "डिवाइस", "समय", "हमला", "रोका गया अनुरोध", "घटना संख्या"],
  bn: ["আক্রমণ শনাক্ত হয়েছে", "আমি জানি তুমি আমাকে হ্যাক করার চেষ্টা করছ।", "তোমার আক্রমণ আটকে দেওয়া হয়েছে এবং লগ করা হয়েছে। এই সংযোগটি ব্লক করা হয়েছে।", "সংযোগ ট্রেস করা হচ্ছে", "নেটওয়ার্ক", "অবস্থান", "ডিভাইস", "সময়", "আক্রমণ", "আটকানো অনুরোধ", "ঘটনা নম্বর"],
  zh: ["检测到攻击", "我知道你在试图入侵我。", "你的攻击已被拦截并记录。此连接已被封禁。", "正在追踪连接", "网络", "位置", "设备", "时间", "攻击", "被拦截的请求", "事件编号"],
  "zh-Hant": ["偵測到攻擊", "我知道你在試圖入侵我。", "你的攻擊已被攔截並記錄。此連線已被封鎖。", "正在追蹤連線", "網路", "位置", "裝置", "時間", "攻擊", "被攔截的請求", "事件編號"],
  ja: ["攻撃を検知しました", "あなたが私をハッキングしようとしているのは分かっています。", "あなたの攻撃はブロックされ、記録されました。この接続はブロックされています。", "接続を追跡中", "ネットワーク", "所在地", "デバイス", "時刻", "攻撃", "ブロックされたリクエスト", "インシデント番号"],
  ko: ["공격 탐지됨", "당신이 저를 해킹하려는 걸 알고 있습니다.", "당신의 공격은 차단되어 기록되었습니다. 이 연결은 차단되었습니다.", "연결 추적 중", "네트워크", "위치", "기기", "시간", "공격", "차단된 요청", "사건 번호"],
  vi: ["PHÁT HIỆN TẤN CÔNG", "Tôi biết bạn đang cố hack tôi.", "Cuộc tấn công của bạn đã bị chặn và ghi lại. Kết nối này đã bị chặn.", "Đang truy vết kết nối", "Mạng", "Vị trí", "Thiết bị", "Thời gian", "Tấn công", "Yêu cầu bị chặn", "Mã sự cố"],
  th: ["ตรวจพบการโจมตี", "ฉันรู้ว่าคุณกำลังพยายามแฮ็กฉัน", "การโจมตีของคุณถูกบล็อกและบันทึกไว้แล้ว การเชื่อมต่อนี้ถูกบล็อก", "กำลังติดตามการเชื่อมต่อ", "เครือข่าย", "ตำแหน่ง", "อุปกรณ์", "เวลา", "การโจมตี", "คำขอที่ถูกบล็อก", "หมายเลขเหตุการณ์"],
  id: ["SERANGAN TERDETEKSI", "Aku tahu kamu sedang mencoba meretasku.", "Seranganmu telah diblokir dan dicatat. Koneksi ini diblokir.", "Melacak koneksi", "Jaringan", "Lokasi", "Perangkat", "Waktu", "Serangan", "Permintaan diblokir", "No. insiden"],
  ms: ["SERANGAN DIKESAN", "Saya tahu anda cuba menggodam saya.", "Serangan anda telah disekat dan direkodkan. Sambungan ini disekat.", "Menjejak sambungan", "Rangkaian", "Lokasi", "Peranti", "Masa", "Serangan", "Permintaan disekat", "No. insiden"],
  km: ["រកឃើញការវាយប្រហារ", "ខ្ញុំដឹងថាអ្នកកំពុងព្យាយាមលួចចូលប្រព័ន្ធរបស់ខ្ញុំ។", "ការវាយប្រហាររបស់អ្នកត្រូវបានរារាំង និងកត់ត្រាទុក។ ការតភ្ជាប់នេះត្រូវបានបិទ។", "កំពុងតាមដានការតភ្ជាប់", "បណ្ដាញ", "ទីតាំង", "ឧបករណ៍", "ពេលវេលា", "ការវាយប្រហារ", "សំណើដែលត្រូវបានរារាំង", "លេខឧប្បត្តិហេតុ"],
  fil: ["NATUKLASAN ANG PAG-ATAKE", "Alam kong sinusubukan mo akong i-hack.", "Na-block at naitala ang iyong pag-atake. Naka-block ang koneksyong ito.", "Tinutunton ang koneksyon", "Network", "Lokasyon", "Device", "Oras", "Pag-atake", "Na-block na request", "Blg. ng insidente"],
};
const SCHLUESSEL = ["titel", "satz", "text", "verfolgen", "netz", "ort", "geraet", "zeit", "art", "anfrage", "nr"];
export const ERWISCHT_SPRACHEN = Object.freeze(Object.keys(T));
const RTL = new Set(["ar", "he", "fa", "ur"]);

const LAND_SPRACHE = {
  de: "DE AT CH LI", fr: "FR MC LU BE SN CI ML BF NE TG BJ GA CG CD CM MG HT GN RE GP MQ GF NC PF YT",
  es: "ES MX AR CO CL PE VE EC GT CU BO DO HN PY SV NI CR PA UY PR GQ", it: "IT SM VA", pt: "PT BR AO MZ CV GW ST TL",
  nl: "NL SR AW CW", pl: "PL", cs: "CZ", sk: "SK", ro: "RO MD", hu: "HU", el: "GR CY", bg: "BG", hr: "HR BA RS ME",
  sv: "SE", da: "DK GL", nb: "NO SJ", fi: "FI", ru: "RU BY KZ KG", uk: "UA", tr: "TR",
  ar: "SA AE EG IQ JO KW LB LY OM QA SY YE BH SD PS MR DZ MA TN", he: "IL", fa: "IR AF", ur: "PK", hi: "IN", bn: "BD",
  zh: "CN", "zh-Hant": "TW HK MO", ja: "JP", ko: "KR", vi: "VN", th: "TH", id: "ID", ms: "MY BN", km: "KH", fil: "PH",
};
const SPRACHE_VON_LAND = new Map(Object.entries(LAND_SPRACHE).flatMap(([sprache, laender]) => laender.split(" ").map(l => [l, sprache])));

export function erwischtSprache(land) {
  return SPRACHE_VON_LAND.get(String(land || "").toUpperCase()) || "en";
}

function texte(sprache) {
  const werte = T[sprache] || T.en;
  return Object.fromEntries(SCHLUESSEL.map((k, i) => [k, werte[i]]));
}

function landName(land, sprache) {
  const code = String(land || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return "";
  try { return new Intl.DisplayNames([sprache, "en"], { type: "region" }).of(code) || code; } catch { return code; }
}

function utcZeit(ms) {
  const d = new Date(Number.isFinite(ms) ? ms : Date.now());
  return `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

// ---------------------------------------------------------------- Stile

// ---------------------------------------------------------------- Variante

// Drei Looks (Preisschild, Universum, Magazin-Cover) wechseln sich je Vorfall
// deterministisch ab - gleiche Vorfall-Nummer, gleiche Variante, kein Zufall je
// Request. Die CSS liegen in waechter-erwischt-texte.js (visuell geprueft).
const VARIANTEN = ["a", "b", "c"];
export function erwischtVariante(nr, override) {
  const o = String(override || "").toLowerCase();
  if (VARIANTEN.includes(o)) return o;
  const s = String(nr || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return VARIANTEN[h % 3];
}
function erwischtCss(variante) {
  return ERWISCHT_BASIS + (variante === "b" ? ERWISCHT_B : variante === "c" ? ERWISCHT_C : ERWISCHT_A);
}

const SPERRE_CSS = `:root{color-scheme:dark}
html{background:#000;color:#f2efe7;font:16px/1.6 "Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;display:flex;justify-content:center;padding:40px 16px;box-sizing:border-box}
main{width:100%;max-width:560px}
.marke{display:inline-block;font-weight:800;letter-spacing:.035em;color:#f2efe7;text-decoration:none;font-size:.92rem;margin-bottom:28px}
section{margin:0 0 26px}
section+section{border-top:1px solid rgba(242,239,231,.14);padding-top:22px}
h1{font-size:1.45rem;line-height:1.25;margin:0 0 10px}
section+section h1{font-size:1.05rem}
p{margin:0 0 10px;color:rgba(242,239,231,.78);font-size:.95rem}
section+section p{font-size:.86rem;color:rgba(242,239,231,.62)}
form{margin:4px 0 30px;padding:18px;border:1px solid rgba(242,239,231,.22);border-radius:4px}
.cf-turnstile{min-height:66px;margin:0 0 14px}
button{appearance:none;border:1px solid #f2efe7;background:#f2efe7;color:#000;font:700 .78rem/1 "Helvetica Neue",Helvetica,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:14px 20px;cursor:pointer;width:100%}
button:focus-visible,a:focus-visible{outline:2px solid #f2efe7;outline-offset:3px}
.fehler{color:#ffb4b4;font-weight:600}
nav{font-size:.82rem;color:rgba(242,239,231,.62);display:flex;flex-wrap:wrap;gap:6px 16px}
nav a{color:#f2efe7}
a{color:#f2efe7}`;

const hashCache = new Map();
async function stilHash(css) {
  if (!hashCache.has(css)) {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(css)));
    hashCache.set(css, `'sha256-${btoa(String.fromCharCode(...bytes))}'`);
  }
  return hashCache.get(css);
}

export async function erwischtCsp(variante) {
  // Produktfotos liegen auf derselben Domain (img-src 'self'); Stil nur als Hash
  // des tatsaechlich ausgelieferten Variantenstils.
  return `default-src 'none'; style-src ${await stilHash(erwischtCss(variante))}; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
}

export async function sperrCsp() {
  // Turnstile: Skript und Rahmen nur von challenges.cloudflare.com; Stil-
  // Attribute setzt das Widget selbst (koennen keinen Code ausfuehren).
  return `default-src 'none'; style-src ${await stilHash(SPERRE_CSS)}; style-src-attr 'unsafe-inline'; script-src https://challenges.cloudflare.com; `
    + "frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
}

// ---------------------------------------------------------------- Erwischt

// Die drei Varianten teilen den Kopf (Markentagline unuebersetzt) und den
// Fuss. Alles aus der Anfrage ist in d bereits HTML-maskiert (anzeigeText/
// nutzlastText), Beschriftungen und Produktfelder werden hier maskiert.
const CLAIM = "Curated · Designer · Archive";
const ERWISCHT_FUSS = '<footer class="fuss">disorder119.com · <a href="/impressum/">Impressum</a></footer>';
const BAND_INNER = ["Maison Margiela", "Jean Paul Gaultier", "Y-3", "Balmain", "Raf Simons", "Comme des Garçons", "Yohji Yamamoto", "Walter Van Beirendonck", "Dior", "Prada"]
  .map(m => `${esc(m)}<span>·</span>`).join(" ");

function erwischtKopf(sprache, dir, titel, variante) {
  return `<!DOCTYPE html><html lang="${esc(sprache)}" dir="${dir}"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">`
    + `<meta name="referrer" content="no-referrer"><title>403 · ${esc(titel)}</title><style>${erwischtCss(variante)}</style></head>`;
}

// Kuerzt nach Zeichen (nicht Bytes), ohne zu maskieren - das macht der Aufrufer.
function kurzText(wert, max) {
  const zeichen = Array.from(String(wert ?? "").replace(/[\r\n\t]/g, " "));
  return zeichen.length > max ? zeichen.slice(0, max).join("") : zeichen.join("");
}

// Lokalisierter Preis (ganze Euro); faellt auf "<n> €" zurueck.
function preisText(preis, locale) {
  const n = Number(preis);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat(locale || "en-GB", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
  } catch { return `${Math.round(n)} €`; }
}

// Sperrdauer aus dem Sperr-Ende (bis). Ohne sichere Angabe neutral (dNull):
// 24 h normal, 7 Tage Wiederholungstaeter, 2 h Kampagne.
function dauerText(bis, jetzt, vt) {
  const ms = Date.parse(String(bis || "")) - (Number.isFinite(jetzt) ? jetzt : Date.now());
  if (!Number.isFinite(ms) || ms <= 0) return vt.dNull;
  if (ms >= 36 * 3600_000) return `${Math.round(ms / 86400_000)} ${vt.tage}`;
  return `${Math.max(1, Math.round(ms / 3600_000))} ${vt.std}`;
}

// Produktkarten aufbereiten: Name ohne Marke, lokalisierter Preis, nur eigene
// Asset-Pfade und reine Artikelnummern. d.produkte ist die im Worker gecachte
// Liste verfuegbarer Teile; bei Ausfall bleibt sie leer und die Seite ohne Teile.
function produktKarten(produkte, sprache, locale) {
  if (!Array.isArray(produkte)) return [];
  const pfad = sprache === "fr" ? "/fr/artikel/" : sprache === "en" ? "/en/artikel/" : "/artikel/";
  const out = [];
  for (const p of produkte) {
    if (!p) continue;
    const bild = String(p.bild || "");
    if (!/^assets\/img\/[A-Za-z0-9/_.-]+\.(?:webp|jpg|jpeg|png)$/.test(bild)) continue;
    const marke = String(p.marke || "");
    const titel = sprache === "de" ? String(p.titel || "") : String(p.titelEn || p.titel || "");
    const name = marke && titel.startsWith(marke) ? titel.slice(marke.length).trim() : titel;
    const art = String(p.nr || "").replace(/\D/g, "").slice(0, 8);
    out.push({
      marke: kurzText(marke, 40), name: kurzText(name || titel, 70), preis: preisText(p.preis, locale),
      href: art ? `${pfad}${art}/` : "/", klein: "/" + bild, gross: "/" + bild.replace("/thumbs/", "/grid/"),
      kat: String(p.kat || ""),
    });
  }
  return out;
}

// ---------------------------------------------------------------- Variante A: Preisschild
function erwischtA(c) {
  const { vt, ven, t, ten, dir, en, sprache, variante, start } = c;
  const row = (k, ke, w) => `<div><dt>${esc(k)}${en ? `<small lang="en">${esc(ke)}</small>` : ""}</dt><dd>${w}</dd></div>`;
  const karten = c.karten.slice(0, 5);
  const grid = karten.map(x =>
    `<li><a href="${esc(x.href)}"><div class="rahmen"><img src="${esc(x.klein)}" srcset="${esc(x.klein)} 220w, ${esc(x.gross)} 405w" sizes="(max-width:860px) 45vw, 200px" alt="${esc(x.marke)} ${esc(x.name)}" width="220" height="293" loading="lazy" decoding="async"></div>`
    + `<span class="tm">${esc(x.marke)}</span><span class="tn">${esc(x.name)}</span><span class="tp">${esc(x.preis)}</span></a></li>`).join("");
  const statt = karten.length
    ? `<section class="statt"><div class="statt-kopf"><h2>${esc(vt.statt)}${en ? `<span lang="en">${esc(ven.statt)}</span>` : ""}</h2><a class="archiv" href="${start}">${esc(vt.archiv)} →</a></div>`
      + `<ul class="teile">${grid}</ul><p class="spaeter">${esc(vt.spaeter)}${en ? ` <span lang="en">${esc(ven.spaeter)}</span>` : ""}</p></section>`
    : "";
  return erwischtKopf(sprache, dir, vt.aTitel, variante)
    + `<body><header class="kopf"><a class="marke" href="${start}">Disorder119</a><span class="claim">${esc(CLAIM)}</span><span class="code403">403${c.vorschau ? " · PREVIEW" : ""}</span></header>`
    + '<main><section class="buehne"><div>'
    + `<h1>${esc(vt.aTitel)}</h1>${en ? `<p class="h1en" lang="en">${esc(ven.aTitel)}</p>` : ""}`
    + `<p class="witz">${esc(vt.aWitz)}</p>${en ? `<p class="witz" lang="en">${esc(ven.aWitz)}</p>` : ""}`
    + `<p class="wahr">${esc(c.status)}</p>${en ? `<p class="wahr" lang="en">${esc(c.statusEn)}</p>` : ""}`
    + `</div><div class="haken"><article class="tag" aria-label="${esc(t.nr)} ${esc(c.nr)}">`
    + '<div class="tag-kopf"><b>DISORDER119</b><span>Archive</span></div>'
    + `<p class="tag-nr"><span dir="ltr">N° ${esc(c.nr)}</span><span dir="ltr">${c.datum}</span></p><dl>`
    + row(vt.item, ven.item, `<span class="fett">${esc(vt.wAngriff)}</span>`)
    + row(vt.stil, ven.stil, esc(c.art))
    + row(vt.zustand, ven.zustand, esc(vt.wBlock))
    + row(vt.herkunft, ven.herkunft, `<span dir="ltr">${c.ip}</span><br>${c.netz}<br>${c.ort}`)
    + row(t.geraet, ten.geraet, `<span dir="ltr">${c.geraet}</span>`)
    + row(t.zeit, ten.zeit, `<span dir="ltr">${c.zeit}</span>`)
    + row(t.anfrage, ten.anfrage, `<code dir="ltr">${c.nutzlast}</code>`)
    + `</dl><div class="preis"><span>${esc(vt.preis)}${en ? `<small lang="en">${esc(ven.preis)}</small>` : ""}</span><strong>${esc(c.dauer)}</strong></div>`
    + `<div class="code" aria-hidden="true"><div class="balken"></div><span dir="ltr">${esc(c.nr)}</span></div>`
    + `<p class="klein">${esc(vt.klein)}</p></article></div></section>`
    + statt + '</main>' + ERWISCHT_FUSS + '</body></html>';
}

// ---------------------------------------------------------------- Variante B: Universum
function erwischtB(c) {
  const { vt, ven, t, dir, en, sprache, variante, start } = c;
  const links = [], rechts = [];
  c.karten.slice(0, 8).forEach((x, i) => (i % 2 ? rechts : links).push(x));
  const stern = (x, idx) =>
    `<li class="s${idx === 3 ? " fern" : ""}"><a href="${esc(x.href)}" aria-label="${esc(x.marke)} – ${esc(x.name)} – ${esc(x.preis)}">`
    + `<img src="${esc(x.klein)}" srcset="${esc(x.klein)} 220w, ${esc(x.gross)} 405w" sizes="(max-width:900px) 110px, 180px" alt="" width="220" height="293" decoding="async">`
    + `<span><b>${esc(x.marke)}</b>${esc(x.preis)}</span></a></li>`;
  const liste = arr => arr.map((x, i) => stern(x, i)).join("");
  const row = (k, w) => `<div><dt>${esc(k)}</dt><dd>${w}</dd></div>`;
  return erwischtKopf(sprache, dir, vt.bTitel, variante)
    + '<body><div class="himmel" aria-hidden="true"></div>'
    + `<main class="buehne"><ul class="schwarm links">${liste(links)}</ul>`
    + `<section class="mitte"><p class="claim">${esc(CLAIM)}${c.vorschau ? " · PREVIEW" : ""}</p><p class="wort">Disorder119</p>`
    + `<h1>${esc(vt.bTitel)}</h1>${en ? `<p class="h1en" lang="en">${esc(ven.bTitel)}</p>` : ""}`
    + `<div class="log"><div class="log-kopf"><span>${esc(vt.log)}</span><b dir="ltr">${esc(c.nr)}</b></div><dl>`
    + row("IP", `<span dir="ltr">${c.ip}</span>`) + row(t.netz, c.netz) + row(t.ort, c.ort)
    + row(t.geraet, `<span dir="ltr">${c.geraet}</span>`) + row(t.zeit, `<span dir="ltr">${c.zeit}</span>`) + row(t.art, `<span dir="ltr">${esc(c.art)}</span>`)
    + row(t.anfrage, `<code dir="ltr">${c.nutzlast}</code>`) + row(vt.dauer, esc(c.dauer))
    + '</dl></div>'
    + `<p class="wahr">${esc(c.status)}</p>${en ? `<p class="wahr" lang="en">${esc(c.statusEn)}</p>` : ""}`
    + `<a class="archiv" href="${start}">${esc(vt.archiv)}</a><p class="spaeter">${esc(vt.spaeter)}${en ? ` · <span lang="en">${esc(ven.spaeter)}</span>` : ""}</p>`
    + `</section><ul class="schwarm rechts">${liste(rechts)}</ul></main>`
    + ERWISCHT_FUSS + '</body></html>';
}

// ---------------------------------------------------------------- Variante C: Magazin-Cover
function erwischtC(c) {
  const { vt, ven, dir, en, sprache, variante } = c;
  const held = c.karten.find(x => /jacket|coat|jacke|mantel/i.test(x.kat)) || c.karten[0] || null;
  const rest = c.karten.filter(x => x !== held).slice(0, 4);
  const cover = held
    ? `<figure class="held"><a href="${esc(held.href)}"><img src="${esc(held.gross)}" srcset="${esc(held.klein)} 220w, ${esc(held.gross)} 405w" sizes="(max-width:860px) 62vw, 400px" alt="${esc(held.marke)} ${esc(held.name)}" width="405" height="540" decoding="async">`
      + `<figcaption><b>${esc(vt.cover)}${en ? ` · <span lang="en">${esc(ven.cover)}</span>` : ""}</b>${esc(held.marke)} — ${esc(held.name)} — ${esc(held.preis)}</figcaption></a></figure>`
    : "";
  const looks = rest.length
    ? `<section class="look"><h2>LOOKS 02–05 — ${esc(vt.echteTeile)}${en ? `<span lang="en">${esc(ven.echteTeile)}</span>` : ""}</h2><ul class="looks">`
      + rest.map((x, k) =>
        `<li><a href="${esc(x.href)}"><div class="r"><img src="${esc(x.klein)}" srcset="${esc(x.klein)} 220w, ${esc(x.gross)} 405w" sizes="(max-width:860px) 45vw, 300px" alt="${esc(x.marke)} ${esc(x.name)}" width="220" height="293" loading="lazy" decoding="async"></div>`
        + `<span class="n" aria-hidden="true">${String(k + 2).padStart(2, "0")}</span><span class="tm">${esc(x.marke)}</span><span class="tn">${esc(x.name)}</span><span class="tp">${esc(x.preis)}</span></a></li>`).join("")
      + '</ul></section>'
    : "";
  const cr = (k, ke, w) => `<p><b>${esc(k)}${en ? ` <small lang="en">/ ${esc(ke)}</small>` : ""}</b>${w}</p>`;
  return erwischtKopf(sprache, dir, `${vt.cTitel1} ${vt.cTitel2}`, variante)
    + `<body><div class="leiste"><span dir="ltr">N° <b>${esc(c.nr)}</b></span><span class="weg">${esc(CLAIM)}</span><span dir="ltr">${c.datum} · 403${c.vorschau ? " · PREVIEW" : ""}</span></div>`
    + '<svg class="titel" viewBox="0 0 1000 101" role="img" aria-label="Disorder119"><text x="0" y="101" textLength="1000" lengthAdjust="spacing">DISORDER119</text></svg>'
    + `<div class="unterzeile"><span>${esc(CLAIM)}</span><span>Issue 403</span></div>`
    + '<main><section class="cover"><div>'
    + `<p class="kicker">${esc(vt.tag)}${en ? ` · <span lang="en">${esc(ven.tag)}</span>` : ""}</p>`
    + `<h1>${esc(vt.cTitel1)}<em>${esc(vt.cTitel2)}</em></h1>${en ? `<p class="h1en" lang="en">${esc(ven.cTitel1)} ${esc(ven.cTitel2)}</p>` : ""}`
    + '<ul class="zeilen">'
    + `<li><span class="s">p.403</span><div><p>${esc(vt.z1)}</p>${en ? `<p lang="en">${esc(ven.z1)}</p>` : ""}</div></li>`
    + `<li><span class="s">p.119</span><div><p>${esc(vt.z2)}</p>${en ? `<p lang="en">${esc(ven.z2)}</p>` : ""}</div></li>`
    + '</ul></div>' + cover + '</section>'
    + `<section class="look"><h2>LOOK 01 — ${esc(vt.angriffWort)}${en ? `<span lang="en">${esc(ven.angriffWort)}</span>` : ""}</h2><div class="credits">`
    + cr(vt.getragen, ven.getragen, `<span dir="ltr">${c.ip}</span> · ${c.netz} · ${c.ort}`)
    + cr(vt.acc, ven.acc, `<span dir="ltr">${c.geraet}</span>`)
    + cr(vt.piece, ven.piece, `${esc(c.art)} — <code dir="ltr">${c.nutzlast}</code>`)
    + cr(vt.shot, ven.shot, `<span dir="ltr">${c.zeit}</span>`)
    + cr(vt.dauer, ven.dauer, esc(c.dauer))
    + cr(vt.status, ven.status, `${esc(c.status)}${en ? ` <span lang="en">${esc(c.statusEn)}</span>` : ""}`)
    + '</div></section>' + looks
    + `<p class="spaeter">${esc(vt.spaeter)}${en ? ` <span lang="en">${esc(ven.spaeter)}</span>` : ""}</p>`
    + `<div class="band" aria-hidden="true"><p>${BAND_INNER} ${BAND_INNER}</p></div></main>`
    + ERWISCHT_FUSS + '</body></html>';
}

// d: { ip, land, stadt, region, netz, asn, ua, zeit, grund, nutzlast, nr, bis?,
//      produkte?, sprache?, variante?, vorschau? }
export function erwischtSeite(d = {}) {
  const sprache = V[d.sprache] ? d.sprache : erwischtSprache(d.land);
  const variante = erwischtVariante(d.nr, d.variante);
  const vt = V[sprache] || V.en, ven = V.en, t = texte(sprache), ten = texte("en");
  const ort = [d.stadt, d.region && d.region !== d.stadt ? d.region : "", landName(d.land, sprache)].filter(Boolean).map(x => anzeigeText(x, 60)).join(", ") || "—";
  const netz = d.netz ? `${anzeigeText(d.netz, 60)}${d.asn ? ` (AS${Number(d.asn) || ""})` : ""}` : (d.asn ? `AS${Number(d.asn) || ""}` : "—");
  const zeitRoh = utcZeit(d.zeit);
  const c = {
    sprache, variante, vt, ven, t, ten, dir: RTL.has(sprache) ? "rtl" : "ltr", en: sprache !== "en",
    start: sprache === "fr" ? "/fr/" : sprache === "en" ? "/en/" : "/", vorschau: Boolean(d.vorschau),
    ip: anzeigeText(d.ip || "—", 64), netz, ort, geraet: anzeigeText(geraetText(d.ua), 60),
    zeit: esc(zeitRoh), datum: esc(zeitRoh.slice(0, 10)),
    art: ART_NAME[d.grund] || "Attack", nr: String(d.nr || "").replace(/[^A-Z0-9-]/gi, "").slice(0, 16) || "—",
    nutzlast: nutzlastText(d.nutzlast), status: t.text, statusEn: ten.text,
    dauer: dauerText(d.bis, d.zeit, vt), karten: produktKarten(d.produkte, sprache, vt.locale),
  };
  return variante === "b" ? erwischtB(c) : variante === "c" ? erwischtC(c) : erwischtA(c);
}

// ---------------------------------------------------------------- Neutrale Sperrseite

const SPERR_TEXT = {
  de: {
    titel: "Kurz anhalten, bitte",
    grund: "Von deinem Internetanschluss kamen auffällige Anfragen, deshalb ist er vorübergehend gesperrt. Das kann auch Unbeteiligte treffen – etwa im Mobilfunknetz, im Firmen- oder Uni-WLAN oder mit iCloud Privat-Relay, wo sich viele Menschen eine Adresse teilen.",
    selbst: "Bestätige kurz, dass du ein Mensch bist – dann geht es sofort weiter.",
    bis: "Die Sperre endet am {bis}. Ist das ein Irrtum? Schreib uns an kontakt@disorder119.com.",
    fehler: "Die Bestätigung hat nicht geklappt. Bitte versuch es noch einmal.",
    knopf: "Weiter zum Shop",
    links: [["Impressum", "/impressum/"], ["Datenschutz", "/datenschutz/"], ["AGB", "/agb/"], ["Widerruf", "/widerruf/"]],
    locale: "de-DE",
  },
  en: {
    titel: "Please hold on a moment",
    grund: "We received unusual requests from your internet connection, so it is temporarily blocked. This can also affect people who did nothing wrong – for example on mobile networks, office or university Wi-Fi, or iCloud Private Relay, where many people share one address.",
    selbst: "Please confirm that you are human – then you can continue right away.",
    bis: "The block ends on {bis}. Is this a mistake? Write to us at kontakt@disorder119.com.",
    fehler: "The check did not work. Please try again.",
    knopf: "Continue to the shop",
    links: [["Legal notice", "/en/impressum/"], ["Privacy", "/en/datenschutz/"], ["Terms", "/en/agb/"], ["Withdrawal", "/en/widerruf/"]],
    locale: "en-GB",
  },
  fr: {
    titel: "Un petit instant, s'il vous plaît",
    grund: "Nous avons reçu des requêtes inhabituelles depuis votre connexion internet ; elle est donc temporairement bloquée. Cela peut aussi toucher des personnes qui n'ont rien fait – par exemple sur un réseau mobile, un Wi-Fi d'entreprise ou d'université, ou avec iCloud Private Relay, où beaucoup de personnes partagent une même adresse.",
    selbst: "Confirmez simplement que vous êtes un humain – vous pourrez continuer tout de suite.",
    bis: "Le blocage prend fin le {bis}. Une erreur ? Écrivez-nous à kontakt@disorder119.com.",
    fehler: "La vérification n'a pas fonctionné. Veuillez réessayer.",
    knopf: "Continuer vers la boutique",
    links: [["Mentions légales", "/fr/impressum/"], ["Confidentialité", "/fr/datenschutz/"], ["CGV", "/fr/agb/"], ["Rétractation", "/fr/widerruf/"]],
    locale: "fr-FR",
  },
};

const FRANZOESISCH = new Set(["FR", "BE", "LU", "MC", "SN", "CI", "ML", "BF", "NE", "TG", "BJ", "GA", "CG", "CD", "CM", "MG", "HT", "DZ", "MA", "TN"]);
const DEUTSCH = new Set(["DE", "AT", "CH", "LI"]);

export function sperrSprache(pfad, land) {
  const p = String(pfad || "");
  if (/^\/en(?:\/|$)/.test(p)) return "en";
  if (/^\/fr(?:\/|$)/.test(p)) return "fr";
  const l = String(land || "").toUpperCase();
  if (FRANZOESISCH.has(l)) return "fr";
  if (DEUTSCH.has(l) || !l) return "de";
  return "en";
}

function bisText(bis, locale) {
  const ms = Date.parse(String(bis || ""));
  if (!Number.isFinite(ms)) return "";
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: "Europe/Berlin", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
  } catch { return new Date(ms).toISOString().slice(0, 16).replace("T", " "); }
}

// Nur eigene, relative Pfade als Ruecksprung (keine offene Weiterleitung).
export function sichererRuecksprung(wert) {
  const text = String(wert || "").slice(0, 300);
  if (!/^\/(?![/\\])/.test(text) || /[\u0000-\u001f\u007f\\]/.test(text)) return "/";
  try {
    const url = new URL(text, "https://disorder119.com");
    if (url.origin !== "https://disorder119.com" || url.pathname.startsWith("/_waechter/")) return "/";
    return `${url.pathname}${url.search}`;
  } catch { return "/"; }
}

// s: { sprache, selbst, bis, zurueck, fehler, siteKey }
export function sperrSeite(s = {}) {
  const erste = SPERR_TEXT[s.sprache] ? s.sprache : "de";
  const reihe = [erste, ...["de", "en", "fr"].filter(x => x !== erste)];
  const abschnitt = (sprache, haupt) => {
    const t = SPERR_TEXT[sprache];
    const bis = bisText(s.bis, t.locale);
    return `<section lang="${sprache}"><h1>${esc(t.titel)}</h1><p>${esc(t.grund)}</p>`
      + (s.fehler && haupt ? `<p class="fehler" role="alert">${esc(t.fehler)}</p>` : "")
      + (s.selbst ? `<p>${esc(t.selbst)}</p>` : (bis ? `<p>${esc(t.bis.replace("{bis}", bis))}</p>` : ""))
      + "</section>";
  };
  const t = SPERR_TEXT[erste];
  const formular = s.selbst
    ? `<form method="post" action="${ENTSPERREN_PFAD}"><input type="hidden" name="zurueck" value="${esc(sichererRuecksprung(s.zurueck))}">`
      + `<div class="cf-turnstile" data-sitekey="${esc(s.siteKey || TURNSTILE_SITE_KEY)}" data-theme="dark" data-language="${erste}"></div>`
      + `<button type="submit">${esc(t.knopf)}</button></form>`
    : "";
  return `<!DOCTYPE html><html lang="${erste}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>DISORDER119</title><style>${SPERRE_CSS}</style>`
    + (s.selbst ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : "")
    + '</head><body><main><a class="marke" href="/impressum/">DISORDER119</a>'
    + abschnitt(reihe[0], true) + formular + abschnitt(reihe[1], false) + abschnitt(reihe[2], false)
    + `<nav lang="${erste}">${t.links.map(([name, href]) => `<a href="${href}">${esc(name)}</a>`).join("")}</nav>`
    + "</main></body></html>";
}

// ---------------------------------------------------------------- Antworten

function kopf(csp, extra = {}) {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    ...extra,
  };
}

export async function erwischtAntwort(request, daten, status = 403) {
  // CSP-Hash muss zum tatsaechlich ausgelieferten Variantenstil passen.
  const variante = erwischtVariante(daten?.nr, daten?.variante);
  return new Response(request?.method === "HEAD" ? null : erwischtSeite(daten), { status, headers: kopf(await erwischtCsp(variante)) });
}

export async function sperrAntwort(request, daten, status = 403) {
  return new Response(request?.method === "HEAD" ? null : sperrSeite(daten), { status, headers: kopf(await sperrCsp()) });
}

// Vorfall-Nummer: zufaellig, ohne verwechselbare Zeichen.
export function vorfallNummer() {
  const zeichen = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return `W-${Array.from(bytes, b => zeichen[b % zeichen.length]).join("")}`;
}

// Beispieldaten fuer die Vorschau (Admin-App -> Sicherheit). Nichts davon
// stammt aus einer echten Anfrage; die IP ist aus dem Dokumentationsbereich.
const VORSCHAU_ORTE = {
  FR: ["Paris", "Île-de-France", "Exemple Hébergement SAS", 64512], DE: ["Frankfurt am Main", "Hessen", "Beispiel Hosting GmbH", 64513],
  IN: ["Mumbai", "Maharashtra", "Example Cloud Pvt Ltd", 64514], KH: ["Phnom Penh", "", "Example Telecom", 64515],
  RU: ["Moscow", "", "Example Hosting LLC", 64516], CN: ["Shanghai", "", "Example Cloud", 64517], US: ["Ashburn", "Virginia", "Example Cloud Inc.", 64518],
};
export function vorschauDaten(land, jetzt = Date.now()) {
  const code = /^[A-Z]{2}$/.test(String(land || "").toUpperCase()) ? String(land).toUpperCase() : "FR";
  const [stadt, region, netz, asn] = VORSCHAU_ORTE[code] || ["Example City", "", "Example Network", 64519];
  return {
    ip: "203.0.113.42", land: code, stadt, region, netz, asn, zeit: jetzt, grund: "sql-injection",
    bis: new Date((Number.isFinite(jetzt) ? jetzt : Date.now()) + 24 * 3600_000).toISOString(),
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    nutzlast: "/fr/mieten/?item=1' AND 1=1 UNION SELECT NULL-- -", nr: "W-VORSCHAU", vorschau: true,
  };
}
