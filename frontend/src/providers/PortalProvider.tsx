// @ts-nocheck
import { ReactNode, useState, useCallback } from "react";
import { Movie } from "src/types/Movie";
import { MEDIA_TYPE } from "src/types/Common";
import createSafeContext from "src/lib/createSafeContext";

export interface PortalConsumerProps {
  setPortal: (anchor: HTMLElement | null, video: Movie | null, mediaType?: MEDIA_TYPE) => void;
}
export interface PortalDataConsumerProps {
  anchorElement: HTMLElement | null;
  miniModalMediaData: Movie | null;
  mediaType: MEDIA_TYPE;
}

export const [usePortal, Provider] =
  createSafeContext<PortalConsumerProps["setPortal"]>();

export const [usePortalData, PortalDataProvider] =
  createSafeContext<PortalDataConsumerProps>();

export default function PortalProvider({ children }: { children: ReactNode }) {
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);
  const [miniModalMediaData, setMiniModalMediaData] = useState<Movie | null>(
    null
  );
  const [mediaType, setMediaType] = useState<MEDIA_TYPE>(MEDIA_TYPE.Movie);

  const handleChangePortal = useCallback(
    (anchor: HTMLElement | null, video: Movie | null, type: MEDIA_TYPE = MEDIA_TYPE.Movie) => {
      setAnchorElement(anchor);
      setMiniModalMediaData(video);
      setMediaType(type);
    },
    []
  );

  return (
    <Provider
      value={handleChangePortal}
    >
      <PortalDataProvider
        value={{
          anchorElement,
          miniModalMediaData,
          mediaType,
        }}
      >
        {children}
      </PortalDataProvider>
    </Provider>
  );
}