# FlixIT - archivio video locale

Server Python 3.10+ senza librerie aggiuntive. Solo per file di cui possiedi i diritti di riproduzione. Non scarica o cerca film e non viene pubblicato su Internet.

## Windows / PowerShell

Da FlixIT:

```powershell
python .\local-video\server.py
```

Verifica http://127.0.0.1:8010/health. Il server genera automaticamente la cartella local-video/media. Per tenere i video fuori dal repository (consigliato), prima dell'avvio imposta:

```powershell
$env:FLIXIT_MEDIA_DIR = Join-Path $env:USERPROFILE "Videos\FlixIT"
python .\local-video\server.py
```

In un secondo PowerShell, dalla cartella frontend (dipendenze già installate):

```powershell
$env:REACT_APP_PLAYER_BACKEND_URL = "http://127.0.0.1:8010"
Remove-Item Env:REACT_APP_AUTHORIZED_VIDZEN_EMBEDS -ErrorAction SilentlyContinue
Remove-Item Env:REACT_APP_AUTHORIZED_VIDZEN_MOVIE_IDS -ErrorAction SilentlyContinue
npm start
```

Non inserire configurazioni VidZen nei file .env del frontend mentre usi questa modalità. Apri http://localhost:3000. Il backend generale e MongoDB rimangono separati e necessari per le funzionalità che dipendono da essi.

## Archivio

Esempi di percorsi relativi alla cartella media:

- movie/123.mp4 — film con ID TMDB 123
- tv/456/1/2.mp4 — serie TMDB 456, stagione 1 episodio 2

Usa gli ID effettivi del catalogo e MP4 autorizzati con traccia italiana, se desiderata. Il server trasmette i byte originali, senza transcodifica: 4K solo se il file è davvero 4K, con codec supportato dal browser. La prima versione non seleziona automaticamente tra tracce audio né converte in HLS.

Verifica la risoluzione del video negli strumenti del browser. L'API /api/player/movie/123 deve restituire un URL firmato solo se il file esiste; l'URL scade dopo 12 ore o al riavvio del server e supporta richieste HTTP Range. Dopo ogni riavvio può essere necessario ricaricare la pagina e attendere la scadenza della cache di due minuti o svuotare sessionStorage. Non condividere gli URL firmati.

Questa è una modalità esclusivamente locale, non un sistema di autenticazione per utenti Internet. Non esporre la porta 8010. Nessun test di build o riproduzione è stato eseguito nell'ambiente del repository.
