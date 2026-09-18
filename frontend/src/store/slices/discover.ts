// @ts-nocheck
import { TMDB_V3_API_KEY } from "../../constant";
import { tmdbApi } from "./apiSlice";
import { MEDIA_TYPE, PaginatedMovieResult } from "src/types/Common";
import { MovieDetail } from "src/types/Movie";
import { TVSeasonDetail } from "src/types/TV";
import { createSlice, isAnyOf } from "@reduxjs/toolkit";

const initialState: Record<string, Record<string, PaginatedMovieResult>> = {};
export const initialItemState: PaginatedMovieResult = {
  page: 0,
  results: [],
  total_pages: 0,
  total_results: 0,
};

const discoverSlice = createSlice({
  name: "discover",
  initialState,
  reducers: {
    setNextPage: (state, action) => {
      const { mediaType, itemKey } = action.payload;
      state[mediaType][itemKey].page += 1;
    },
    initiateItem: (state, action) => {
      const { mediaType, itemKey } = action.payload;
      if (!state[mediaType]) state[mediaType] = {};
      if (!state[mediaType][itemKey]) state[mediaType][itemKey] = initialItemState;
    },
  },
  extraReducers(builder) {
    builder.addMatcher(
      isAnyOf(
        extendedApi.endpoints.getVideosByMediaTypeAndCustomGenre.matchFulfilled,
        extendedApi.endpoints.getVideosByMediaTypeAndGenreId.matchFulfilled
      ),
      (state, action) => {
        const {
          page,
          results,
          total_pages,
          total_results,
          mediaType,
          itemKey,
        } = action.payload;
        state[mediaType][itemKey].page = page;
        state[mediaType][itemKey].results.push(...results);
        state[mediaType][itemKey].total_pages = total_pages;
        state[mediaType][itemKey].total_results = total_results;
      }
    );
  },
});

export const { setNextPage, initiateItem } = discoverSlice.actions;
export default discoverSlice.reducer;

const emptyVideos = (id: number) => ({
  id,
  results: [],
});

const extendedApi = tmdbApi.injectEndpoints({
  endpoints: (build) => ({
    getVideosByMediaTypeAndGenreId: build.query<
      PaginatedMovieResult & {
        mediaType: MEDIA_TYPE;
        itemKey: number | string;
      },
      { mediaType: MEDIA_TYPE; genreId: number; page: number }
    >({
      query: ({ mediaType, genreId, page }) => ({
        url: `/discover/${mediaType}`,
        params: {
          api_key: TMDB_V3_API_KEY,
          with_genres: genreId,
          page,
          language: "it-IT",
        },
      }),
      transformResponse: (
        response: PaginatedMovieResult,
        _,
        { mediaType, genreId }
      ) => ({
        ...response,
        mediaType,
        itemKey: genreId,
      }),
    }),

    getVideosByMediaTypeAndCustomGenre: build.query<
      PaginatedMovieResult & {
        mediaType: MEDIA_TYPE;
        itemKey: number | string;
      },
      { mediaType: MEDIA_TYPE; apiString: string; page: number }
    >({
      query: ({ mediaType, apiString, page }) => ({
        url: `/${mediaType}/${apiString}`,
        params: { api_key: TMDB_V3_API_KEY, page, language: "it-IT" },
      }),
      transformResponse: (
        response: PaginatedMovieResult,
        _,
        { mediaType, apiString }
      ) => ({
        ...response,
        mediaType,
        itemKey: apiString,
      }),
    }),

    getAppendedVideos: build.query<
      MovieDetail,
      { mediaType: MEDIA_TYPE; id: number }
    >({
      query: ({ mediaType, id }) => ({
        url: `/${mediaType}/${id}`,
        params: {
          api_key: TMDB_V3_API_KEY,
          // Credits are still used by DetailPage. Trailer metadata is resolved
          // by FLIX-IT's backend, so there is no reason to download TMDB's
          // YouTube video list on every detail/hero request.
          append_to_response: "credits",
          language: "it-IT",
        },
      }),
      transformResponse: (response: any) => ({
        ...response,
        // DetailPage still has a legacy "video key exists" gate. This internal
        // sentinel opens that gate, but TrailerPlayer intercepts it and reads
        // /api/public/trailer; no YouTube URL, iframe or thumbnail is requested.
        videos: {
          results: [
            {
              id: "flixit-resolver-sentinel",
              key: "__flixit_resolver__",
              name: "FLIX-IT Trailer Resolver",
              site: "YouTube",
              type: "Trailer",
              iso_639_1: "it",
            },
          ],
        },
      }),
    }),

    // Legacy compatibility only. Returning an empty collection locally removes
    // two unnecessary TMDB /videos calls from DetailPage and older components.
    getAllVideos: build.query<
      { id: number; results: Array<{ id: string; key: string; name: string; site: string; type: string; iso_639_1: string }> },
      { mediaType: MEDIA_TYPE; id: number }
    >({
      queryFn: async ({ id }) => ({ data: emptyVideos(id) }),
    }),

    getSimilarVideos: build.query<
      PaginatedMovieResult,
      { mediaType: MEDIA_TYPE; id: number }
    >({
      query: ({ mediaType, id }) => ({
        url: `/${mediaType}/${id}/similar`,
        params: { api_key: TMDB_V3_API_KEY, language: "it-IT" },
      }),
    }),

    getMediaImages: build.query<
      {
        id: number;
        logos: Array<{
          aspect_ratio: number;
          height: number;
          iso_639_1: string | null;
          file_path: string;
          vote_average: number;
          vote_count: number;
          width: number;
        }>;
      },
      { mediaType: MEDIA_TYPE; id: number }
    >({
      query: ({ mediaType, id }) => ({
        url: `/${mediaType}/${id}/images`,
        params: {
          api_key: TMDB_V3_API_KEY,
          include_image_language: "it,en,null",
        },
      }),
    }),

    getTVSeasonDetails: build.query<
      TVSeasonDetail,
      { seriesId: number; seasonNumber: number }
    >({
      query: ({ seriesId, seasonNumber }) => ({
        url: `/tv/${seriesId}/season/${seasonNumber}`,
        params: {
          api_key: TMDB_V3_API_KEY,
          language: "it-IT",
        },
      }),
    }),

    getMediaVideos: build.query<
      { id: number; results: Array<{ id: string; key: string; name: string; site: string; type: string; iso_639_1: string }> },
      { mediaType: MEDIA_TYPE; id: number }
    >({
      queryFn: async ({ id }) => ({ data: emptyVideos(id) }),
    }),
  }),
});

export const {
  useGetVideosByMediaTypeAndGenreIdQuery,
  useLazyGetVideosByMediaTypeAndGenreIdQuery,
  useGetVideosByMediaTypeAndCustomGenreQuery,
  useLazyGetVideosByMediaTypeAndCustomGenreQuery,
  useGetAppendedVideosQuery,
  useLazyGetAppendedVideosQuery,
  useGetAllVideosQuery,
  useLazyGetAllVideosQuery,
  useGetSimilarVideosQuery,
  useLazyGetSimilarVideosQuery,
  useGetMediaImagesQuery,
  useLazyGetMediaImagesQuery,
  useGetTVSeasonDetailsQuery,
  useLazyGetTVSeasonDetailsQuery,
  useGetMediaVideosQuery,
  useLazyGetMediaVideosQuery,
} = extendedApi;
