# FlixIT Studio in Emergent

Importare le modifiche da GitHub con `git pull --ff-only origin main`. Se Git segnala conflitti, non eseguire reset o stash dei video. Questo aggiornamento aggiunge file nuovi e modifica soltanto il routing, la home e il menu admin; mantiene i file locali del server video e dell'importatore.

Eseguire da /app:
```bash
python3 local-video/install_studio.py
supervisorctl restart backend frontend
supervisorctl status
```

Aprire il pannello amministrativo esistente con un **superadmin**, scegliere FlixIT Studio, selezionare più MP4, confermare i diritti di distribuzione e avviare. I file identificati vengono inviati in blocchi di 4 MiB, due file in parallelo; l'importatore esistente deve essere attivo. Per riprendere un caricamento interrotto selezionare lo stesso file nello stesso browser; l'offset è salvato sul server. Non cancellare localStorage mentre si sta caricando. Il sistema richiede un singolo processo backend e spazio persistente; non garantisce velocità o limiti della piattaforma Emergent.

I titoli ambigui richiedono [tmdb-ID], serie con S01E01. Il catalogo locale, distinto da quello esterno, mostra solo file analizzati con metadati FFprobe e aggiorna i risultati ogni 15 secondi quando l'utente è autenticato. Riproduzione attraverso il bridge locale configurato nei passaggi precedenti. Le impostazioni VidZen non devono avere precedenza. I codec devono essere supportati dal browser. Non considerare la presenza del file prova di riproducibilità. Non vengono scaricati film da fonti esterne né marcati come disponibili episodi mancanti. Non è incluso un sistema di transcodifica adattiva o un sistema di hosting illimitato. Non esporre il servizio loopback.

Nessun test di build o integrazione Emergent eseguito prima di questa consegna.
