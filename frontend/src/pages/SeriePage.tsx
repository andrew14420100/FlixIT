// @ts-nocheck
import { Route, Routes, useLocation } from "react-router-dom";
import { Component as HomePage } from "./HomePage";

/**
 * /serie-tv e' una pagina autonoma, separata dalla Home.
 * Riusa la stessa esperienza grafica/componenti della Home ma fornisce un
 * contesto di route virtuale con mediaType=tv, cosi Hero, righe, Top 10 e
 * Continua a guardare vengono filtrati esclusivamente sulle serie TV senza
 * cambiare l'URL reale /serie-tv e senza reindirizzare l'utente alla Home.
 */
export function Component() {
  const location = useLocation();
  const seriesLocation = {
    ...location,
    pathname: "/serie-tv/tv",
  };

  return (
    <Routes location={seriesLocation}>
      <Route path=':mediaType' element={<HomePage />} />
    </Routes>
  );
}

Component.displayName = "SeriePage";
