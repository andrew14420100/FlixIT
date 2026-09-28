// @ts-nocheck
import { Component as FilmPage } from "./FilmPage";

/**
 * La voce "Cinema" del menu deve aprire la stessa esperienza della Home,
 * mostrando esclusivamente contenuti movie. Riutilizziamo FilmPage così
 * /cinema e /film restano sempre perfettamente sincronizzate con la Home.
 */
export function Component() {
  return <FilmPage />;
}

Component.displayName = "CinemaHubPage";
export default Component;
