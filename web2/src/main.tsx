import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DemoApp } from "./dev/DemoApp";
import { Gallery } from "./dev/Gallery";
import { LocalApp, localGame } from "./dev/LocalApp";
import "./styles/theme.css";

const params = new URLSearchParams(location.search);
const local = localGame(params);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {local ? <LocalApp game={local} /> : params.has("gallery") ? <Gallery /> : <DemoApp />}
  </StrictMode>,
);
