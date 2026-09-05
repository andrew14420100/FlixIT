// @ts-nocheck
import { CustomGenre } from "src/types/Genre";

export const API_ENDPOINT_URL = process.env.REACT_APP_API_ENDPOINT_URL || "https://api.themoviedb.org/3";
export const TMDB_V3_API_KEY = process.env.REACT_APP_TMDB_V3_API_KEY || "4f153630f8d7e92d542dde3a38fbddf2";

export const MAIN_PATH = {
  root: "",
  browse: "browse",
  genreExplore: "genre",
  watch: "watch",
  detail: "detail",
};

export const ARROW_MAX_WIDTH = 40;
export const COMMON_TITLES: CustomGenre[] = [
  { name: "Film Popolari", apiString: "popular" },
  { name: "Film Più Votati", apiString: "top_rated" },
  { name: "Al Cinema", apiString: "now_playing" },
  { name: "Prossimamente", apiString: "upcoming" },
];

export const TV_TITLES: CustomGenre[] = [
  { name: "Serie TV Popolari", apiString: "popular" },
  { name: "Serie TV Più Votate", apiString: "top_rated" },
  { name: "In Onda Oggi", apiString: "airing_today" },
  { name: "In Onda Questa Settimana", apiString: "on_the_air" },
];

export const YOUTUBE_URL = "https://www.youtube.com/watch?v=";
export const APP_BAR_HEIGHT = 70;

export const INITIAL_DETAIL_STATE = {
  id: undefined,
  mediaType: undefined,
  mediaDetail: undefined,
};
