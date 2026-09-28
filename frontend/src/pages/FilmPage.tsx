// @ts-nocheck
import { Route, Routes, useLocation } from "react-router-dom";
import { Component as HomePage } from "./HomePage";

/**
 * /film e' una pagina autonoma, separata dalla Home.
 * Riusa la stessa esperienza grafica/componenti della Home ma fornisce un
 * contesto di route virtuale con mediaType=movie, cosi Hero, righe, Top 10 e
 * Continua a guardare vengono filtrati esclusivamente sui film senza cambiare
 * l'URL reale /film e senza reindirizzare l'utente alla Home.
 */
export function Component() {
  const location = useLocation();
  const filmLocation = {
    ...location,
    pathname: "/film/movie",
  };

  return (
    <Routes location={filmLocation}>
      <Route path=":mediaType" element={<HomePage />} />
    </Routes>
  );
}

Component.displayName = "FilmPage";
