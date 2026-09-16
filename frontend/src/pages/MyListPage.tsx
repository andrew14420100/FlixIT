// @ts-nocheck
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Grid from "@mui/material/Grid";
import CircularProgress from "@mui/material/CircularProgress";
import HorizontalCard from "src/components/HorizontalCard";
import { MAIN_PATH } from "src/constant";

const API_URL = process.env.REACT_APP_BACKEND_URL || "";

interface Content {
  tmdbId: number;
  type: "movie" | "tv";
  title: string;
  poster_path?: string;
  backdrop_path?: string;
  release_date?: string;
  vote_average?: number;
}

const getUserId = () => {
  let userId = localStorage.getItem("netflix_user_id");
  if (!userId) {
    userId = `user_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem("netflix_user_id", userId);
  }
  return userId;
};

export async function loader() {
  return null;
}

export function Component() {
  const [myList, setMyList] = useState<Content[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const loadMyList = async () => {
      try {
        const userId = getUserId();
        const res = await fetch(`${API_URL}/user/list/${userId}`);
        if (res.ok) {
          const data = await res.json();
          setMyList(data.items || []);
        }
      } catch (err) {
        console.error("Error loading list:", err);
      } finally {
        setIsLoading(false);
      }
    };
    loadMyList();
  }, []);

  return (
    <Box sx={{ pt: 10, px: { xs: 2, md: 4 }, minHeight: "100vh", bgcolor: "#141414" }}>
      <Typography
        variant="h4"
        sx={{
          color: "#fff",
          fontWeight: 700,
          mb: 4,
        }}
      >
        La Mia Lista
      </Typography>

      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
          <CircularProgress sx={{ color: "#e50914" }} />
        </Box>
      ) : myList.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 10 }}>
          <Typography color="grey.500" variant="h6">
            La tua lista è vuota
          </Typography>
          <Typography color="grey.600" variant="body2" sx={{ mt: 1 }}>
            Aggiungi film e serie TV alla tua lista per trovarli facilmente qui.
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            gap: 2,
          }}
        >
          {myList.map((content, index) => (
            <HorizontalCard
              key={content.tmdbId}
              content={content}
              index={index}
              totalCards={myList.length}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

Component.displayName = "MyListPage";
