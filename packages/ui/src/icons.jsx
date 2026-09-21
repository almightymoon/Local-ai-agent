import React from "react";
const paths = {
  plus: "M12 5v14M5 12h14",
  arrow: "M12 19V5m-6 6 6-6 6 6",
  chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 2 2-6A8.5 8.5 0 1 1 21 11.5Z",
  folder: "M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11H3V7Z",
  memory:
    "M9 4a3 3 0 0 0-5 3 4 4 0 0 0-1 7 4 4 0 0 0 6 5V4Zm6 0a3 3 0 0 1 5 3 4 4 0 0 1 1 7 4 4 0 0 1-6 5V4ZM5 10h4m6 5h4",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
  book: "M12 6C9 3 5 3 2 4v15c3-1 7-1 10 2m0-15c3-3 7-3 10-2v15c-3-1-7-1-10 2V6Z",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  sidebar: "M3 4h18v16H3V4Zm5 0v16",
  close: "m6 6 12 12M6 18 18 6",
  code: "m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16",
  terminal: "m4 6 6 6-6 6m9 0h7",
  chevron: "m9 5 7 7-7 7",
  file: "M14 2H4v20h16V8l-6-6Zm0 0v6h6M8 13h8m-8 4h6",
  copy: "M8 8h13v13H8V8Zm8-4V2H2v14h2",
  check: "m5 12 4 4L19 6",
  sun: "M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z",
  moon: "M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5Z",
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Zm-3 6v1a6 6 0 0 0 12 0v-1M12 18v4m-4 0h8",
  sound: "m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
  shield: "m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-4 10 3 3 5-6",
  minimize: "M5 12h14",
  settings: "M4 21v-7M4 10V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6m2-8h6m2 12h6",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z",
  trash: "M3 6h18M8 6V4h8v2m-1 0v14H9V6m-2 4v8m6-8v8",
  dots: "M12 6h.01M12 12h.01M12 18h.01",
};
export function Icon({ name, size = 20, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.spark} />
    </svg>
  );
}
