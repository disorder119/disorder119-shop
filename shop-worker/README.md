# Disorder119 Shop-Automat

Kleiner Cloudflare Worker (kostenlos, keine Kreditkarte fuer den Free-Plan
noetig), der zwischen dem PayPal-Button auf den Artikelseiten und dem Repo
sitzt: Zahlung einziehen, Artikel als verkauft markieren, DHL-Label
erstellen. Der Code (`worker.js`) ist fertig - hier steht nur noch, welche
Konten du dafuer brauchst und wo die Zugangsdaten reinkommen.

## Was du anlegen musst

### 1. PayPal Business Account + App
1. https://www.paypal.com/de/business → Konto eroeffnen (falls noch nicht
   vorhanden), Bankverbindung hinterlegen.
2. Auf https://developer.paypal.com einloggen (mit demselben PayPal-Konto).
3. **Apps & Credentials** → **Create App** → Name z.B. "Disorder119 Shop".
   Du bekommst eine **Client ID** und ein **Secret**. Zum Testen erst mit
   den **Sandbox**-Werten arbeiten (oben rechts umschaltbar), erst wenn
   alles laeuft auf **Live** wechseln.
4. Unter **Webhooks** eine neue Webhook-URL eintragen (die bekommst du von
   mir, sobald der Worker deployed ist - Format `https://...workers.dev/paypal-webhook`),
   Event **PAYMENT.CAPTURE.COMPLETED** abonnieren. Du bekommst dabei eine
   **Webhook ID**.

→ Schick mir: Client ID, Secret, Webhook ID (Sandbox reicht zum Start).

### 2. DHL Geschäftskundenportal + API
1. https://geschaeftskunden.dhl.de → Konto eroeffnen (Kleinunternehmer ist
   hier explizit vorgesehen). Du bekommst eine **EKP-Nummer** (10-stellig)
   und richtest eine Abholadresse ein.
2. https://developer.dhl.com → registrieren, App fuer **"Parcel DE Shipping"**
   anlegen → **API Key** + **API Secret**.
3. Im Geschaeftskundenportal unter "Abrechnung" die **Abrechnungsnummer**
   (Billing Number, Format `EKP-01-01`) fuer den Standardversand (Produkt
   "V01PAK") notieren.
4. Portal-Zugangsdaten (Benutzername/Passwort fuers Geschaeftskundenportal
   selbst, nicht developer.dhl.com) fuer den technischen Login bereithalten.

→ Schick mir: API Key, API Secret, EKP, Billing Number, Portal-Benutzer,
Portal-Passwort, sowie deine Absenderadresse (Name/Strasse/PLZ/Ort) fuers
Label.

### 3. Cloudflare-Konto (fuer den Worker selbst)
1. https://dash.cloudflare.com/sign-up → kostenloses Konto (keine
   Kreditkarte noetig fuer Workers Free).
2. Mir kurz Bescheid geben, dass es steht - das Deployen des Workers
   (`wrangler deploy` + alle Secrets setzen) uebernehme ich dann komplett,
   ich brauche dafuer nur einmal ein **API Token** mit "Edit Cloudflare
   Workers"-Rechten (Dashboard → Mein Profil → API-Token → erstellen).

### 4. GitHub Personal Access Token (damit der Worker "verkauft" eintragen darf)
1. https://github.com/settings/personal-access-tokens/new (fine-grained)
2. Nur fuer das Repo **disorder119-shop**, Berechtigung **Contents:
   Read and write**, sonst nichts.
3. Ablaufdatum grosszuegig setzen (z.B. 1 Jahr), Token einmalig kopieren.

→ Schick mir das Token (am besten nicht im Klartext im Chat - falls du
magst, sag Bescheid, dann finden wir einen sichereren Weg das zu
uebergeben).

### 5. Admin-Token (fuers Verleih-Anfragen-Dashboard)
Uebergangsloesung, bis das echte Admin-Login (Supabase Auth + Cloudflare
Access, siehe `disorder119-admin`-Repo) steht: ein einziges, langes
Zufallsgeheimnis, das der Worker gegen den `Authorization: Bearer ...`-
Header von `GET /rental-requests` prueft.

1. Generiere z.B. mit `openssl rand -hex 32` (Terminal) ein langes,
   zufaelliges Token.
2. `wrangler secret put ADMIN_TOKEN` im `shop-worker/`-Ordner, Wert
   einfuegen.
3. Dasselbe Token traegst du im Admin-Dashboard (`disorder119-admin`-Repo)
   beim ersten Login ein - siehe dortige README.

Dieses Token ist aequivalent zu einem Passwort fuers Admin-Dashboard -
niemals committen, niemals im Klartext teilen, bei Verdacht auf Missbrauch
sofort per `wrangler secret put ADMIN_TOKEN` neu setzen (macht das alte
Token augenblicklich ungueltig).

## Was danach automatisch passiert

Sobald alle Secrets gesetzt sind:
1. Käufer klickt "Jetzt kaufen" auf einer Artikelseite - der Worker
   reserviert das Einzelstück dabei sofort für 15 Minuten (siehe unten),
   damit es niemand anders in der Zwischenzeit ebenfalls kaufen kann.
2. PayPal-Fenster oeffnet sich, Zahlung wird bestaetigt.
3. Worker prueft die Reservierung erneut und zieht erst dann die Zahlung
   ein, markiert den Artikel in `data/items.json` als `SOLD`.
4. Der GitHub-Actions-Workflow (`.github/workflows/rebuild.yml`) baut die
   Seite automatisch neu - der Artikel verschwindet aus dem Katalog.
5. Worker erstellt automatisch ein DHL-Label mit der von PayPal
   uebermittelten Lieferadresse.

### Schutz gegen Doppelverkauf (Reservierung)

Jedes Stück ist ein Einzelstück - zwei Personen duerfen es nie gleichzeitig
erfolgreich kaufen koennen. Der Worker reserviert deshalb ab dem Klick auf
"Jetzt kaufen" (`POST /create-order`) den Artikel atomar fuer 15 Minuten
(`RESERVATION_TTL_MS` in `worker.js`) an genau diese eine PayPal-Bestellung.
Erst wenn beim Zahlungseinzug (`POST /capture-order`) diese Reservierung
noch gueltig und unveraendert ist, wird ueberhaupt Geld abgebucht - vorher
wurde hier immer zuerst abgebucht und erst danach geprueft, ob der Artikel
noch zu haben war. Bricht jemand den Kauf ab (Tab geschlossen, PayPal-
Fenster geschlossen), verfaellt die Reservierung nach 15 Minuten von selbst
und der Artikel wird beim naechsten Kaufversuch automatisch wieder frei -
es gibt dafuer keinen eigenen Aufraeum-Job, das passiert "lazy" beim
naechsten `/create-order` fuer denselben Artikel.

Kosten: PayPal-Transaktionsgebuehr (branchenueblich, kein Weg drumrum),
normales DHL-Porto pro Paket. Keine Monats-/Plattformgebuehr fuer
PayPal, Cloudflare Worker oder GitHub - alles bleibt im kostenlosen Rahmen
bei diesem Bestellvolumen.

## Verleih-Anfragen (Musikvideo/Shooting)

Sobald `shopWorkerUrl` in `config/shop-config.json` auf die Worker-URL
zeigt, sendet das Verleih-Modal auf der Startseite jede Anfrage zusaetzlich
zur WhatsApp-/E-Mail-Nachricht per `POST /rental-request` an den Worker.
Der Worker prueft Artikel und Zeitraum server-seitig nach und haengt die
Anfrage an `data/rental-requests.json` im Repo an (dieselbe Technik wie bei
`data/items.json` - kein eigener Datenbankserver noetig).

Das Admin-Dashboard (separates, privates Repo `disorder119-admin` - noch
nicht deployed, Code liegt bereit) ruft `GET /rental-requests` mit dem
Admin-Token ab und zeigt die Liste an. Solange `apiBaseUrl`/`shopWorkerUrl`
nicht gesetzt ist, passiert auf der Website gar nichts Zusaetzliches - die
Verleih-Anfrage funktioniert dann weiterhin wie bisher rein per WhatsApp/
E-Mail, nur eben ohne zusaetzliche Dashboard-Ansicht.
