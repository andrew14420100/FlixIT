// @ts-nocheck
import { Route, Routes } from "react-router-dom";
import { Component as HomePage } from "./HomePage";

/**
 * Pagina Film = stessa esperienza della Home, con il filtro movie applicato
 * all'intera pagina. Usiamo la stessa HomePage (Hero, righe, Top 10,
 * Continua a guardare, responsive/mobile) così ogni futura modifica alla Home
 * viene ereditata automaticamente anche qui.
 */
export function Component() {
  return (
    <Routes location="/browse/genre/movie">
      <Route path="/browse/genre/:mediaType" element={<HomePage />} />
    </Routes>
  );
}

Component.displayName = "FilmPage";
