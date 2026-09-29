# Apple Pay und Checkout

Die Kasse verlangt eine E-Mail-Adresse für Bestellbestätigung und Rechnung. Die
Kontoerstellung ist freiwillig und standardmäßig ausgeschaltet. Bei Auswahl
wird erst nach erfolgreicher Zahlung ein einmaliger Anmeldelink gesendet; das
Konto entsteht erst nach Bestätigung dieses Links.

Apple Pay nutzt dieselbe serverseitige Bestellung, Reservierung und
PayPal-Erfassung wie der PayPal-Knopf. Der Button erscheint nur, wenn
`paypal.Applepay().config()` den Händler als berechtigt meldet und das Gerät
Apple Pay unterstützt. Solange ein Gutschein aktiv ist, bleibt Apple Pay
ausgeblendet, weil der endgültige Rabatt erst serverseitig geprüft wird.

Für den Livebetrieb muss im **Live**-Bereich der PayPal Developer Console
Apple Pay für die verwendete App aktiviert und `disorder119.com` registriert
werden. Die offizielle Domainbestätigungsdatei liegt unter
`/.well-known/apple-developer-merchantid-domain-association`. Vor der
Registrierung prüfen: HTTPS, Status 200 ohne Weiterleitung und
`Content-Type: application/octet-stream`. Ein echter Testkauf mit einer
geeigneten Apple Wallet ist anschließend erforderlich; ein Worker-Test kann
die Freischaltung im PayPal-Konto nicht beweisen.

Die D1-Migration `0025_checkout_contact.sql` muss vor dem Worker-Release
angewendet werden. Das Backend verwirft Bestellungen ohne gültige E-Mail,
bevor eine Reservierung oder PayPal-Bestellung angelegt wird.

PayPal-Anleitung: https://developer.paypal.com/v5/apple-pay/integrate/
