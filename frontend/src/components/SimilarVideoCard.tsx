// @ts-nocheck
import { useNavigate } from "react-router-dom";
import Stack from "@mui/material/Stack";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import { Movie } from "src/types/Movie";
import NetflixIconButton from "./NetflixIconButton";
import MaxLineTypography from "./MaxLineTypography";
import { formatMinuteToReadable, getRandomNumber } from "src/utils/common";
import AgeLimitChip from "./AgeLimitChip";
import { useGetConfigurationQuery } from "src/store/slices/configuration";
import { MAIN_PATH } from "src/constant";
import { MEDIA_TYPE } from "src/types/Common";
import { getMediaImageUrl } from "src/hooks/useCDNImage";

interface SimilarVideoCardProps {
  video: Movie;
}

export default function SimilarVideoCard({ video }: SimilarVideoCardProps) {
  const navigate = useNavigate();
  const { data: configuration } = useGetConfigurationQuery(undefined);

  // Naviga SEMPRE su pagina dedicata
  const handleNavigateToDetail = () => {
    navigate(`/${MAIN_PATH.browse}/${MEDIA_TYPE.Movie}/${video.id}`);
  };
  // Usa CDN se disponibile, altrimenti TMDB
  const imageUrl = getMediaImageUrl(
    video.id,
    'backdrop',
    video.backdrop_path,
    configuration?.images.base_url,
    'w780'
  );

  return (
    <Card 
      sx={{ 
        cursor: "pointer",
        transition: "transform 0.3s ease",
        "&:hover": { transform: "scale(1.03)" }
      }}
      onClick={handleNavigateToDetail}
      data-testid={`similar-card-${video.id}`}
    >
      <div
        style={{
          width: "100%",
          position: "relative",
          paddingTop: "calc(9 / 16 * 100%)",
        }}
      >
        <img
          src={imageUrl}
          style={{
            top: 0,
            height: "100%",
            position: "absolute",
          }}
          alt={video.title}
        />
        <div
          style={{
            top: 10,
            right: 15,
            position: "absolute",
          }}
        >
          <Typography variant="subtitle2">{`${formatMinuteToReadable(
            getRandomNumber(180)
          )}`}</Typography>
        </div>
        <div
          style={{
            left: 0,
            right: 0,
            bottom: 0,
            paddingLeft: "16px",
            paddingRight: "16px",
            paddingBottom: "4px",
            position: "absolute",
          }}
        >
          <MaxLineTypography
            maxLine={1}
            sx={{ width: "80%", fontWeight: 700 }}
            variant="subtitle1"
          >
            {video.title}
          </MaxLineTypography>
        </div>
      </div>
      <CardContent>
        <Stack spacing={1}>
          <Stack direction="row" alignItems="center">
            <div>
              <Typography
                variant="subtitle2"
                sx={{ color: "success.main" }}
              >{`${getRandomNumber(100)}% Corrispondenza`}</Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <AgeLimitChip label={`${getRandomNumber(20)}+`} />
                <Typography variant="body2">
                  {video.release_date?.substring(0, 4)}
                </Typography>
              </Stack>
            </div>
            <div style={{ flexGrow: 1 }} />
            <NetflixIconButton onClick={(e) => e.stopPropagation()}>
              <AddIcon />
            </NetflixIconButton>
          </Stack>
          <MaxLineTypography maxLine={4} variant="subtitle2">
            {video.overview}
          </MaxLineTypography>
        </Stack>
      </CardContent>
    </Card>
  );
}
