import { MAP_PATH } from '../../data/mapData';

export function MapPath() {
  return (
    <>
      {/* Road shadow */}
      <path
        d={MAP_PATH}
        stroke="#a0845a"
        strokeWidth="22"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.4"
      />
      {/* Road surface */}
      <path
        d={MAP_PATH}
        stroke="#e8c97a"
        strokeWidth="16"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Road dashes */}
      <path
        d={MAP_PATH}
        stroke="#f5e4a8"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="12 20"
        opacity="0.7"
      />
    </>
  );
}
