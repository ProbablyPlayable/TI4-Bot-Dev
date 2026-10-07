import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DemoApp } from "./dev/DemoApp";
import { Gallery } from "./dev/Gallery";
import "./styles/theme.css";

const gallery = new URLSearchParams(location.search).has("gallery");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{gallery ? <Gallery /> : <DemoApp />}</StrictMode>,
);
