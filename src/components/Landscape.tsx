// Original procedural vector artwork. Deterministic geometry, no borrowed game textures.
export function Landscape({
  variant = 0,
  hero = false,
}: {
  variant?: number;
  hero?: boolean;
}) {
  const palettes = [
    ["#edc981", "#c6cbae", "#597a66", "#365e51", "#d69b61"],
    ["#c5cee0", "#a5b7ba", "#708b79", "#405d61", "#baa383"],
    ["#e7bf9e", "#ccae99", "#967f79", "#645f70", "#b98c61"],
    ["#c6d6c2", "#9ebeb2", "#58806b", "#355856", "#baa67a"],
  ];
  const p = palettes[variant % 4];
  const key = `scene-${variant}-${hero ? "hero" : "card"}`;
  const trees = Array.from({ length: 30 }, (_, i) => ({
    x: 340 + ((i * 137 + variant * 33) % 710),
    y: 200 + ((i * 43) % 140),
    size: 14 + (i % 5) * 5,
  })).sort((a, b) => a.y - b.y);
  return (
    <svg
      viewBox="0 0 1100 400"
      preserveAspectRatio="xMidYMid slice"
      className="landscape"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${key}-sky`} x2="0" y2="1">
          <stop stopColor={p[0]} />
          <stop offset="1" stopColor="#f6e6bd" />
        </linearGradient>
        <linearGradient id={`${key}-water`} x2="0" y2="1">
          <stop stopColor="#bdc9b9" />
          <stop offset="1" stopColor="#7ca9a5" />
        </linearGradient>
      </defs>
      <rect width="1100" height="400" fill={`url(#${key}-sky)`} />
      <circle cx="860" cy="85" r="42" fill="#fff0ba" opacity=".92" />
      <path
        d="M20 155h80v-10h90v10h70v10H20m520-110h45V33h60v12h65v13H540m320 70h95v-8h58v8h60v10H860"
        fill="#fff5d4"
        opacity=".55"
      />
      <path
        d="m250 245 95-93h35v-32h28v-33h34v-24h27v32h28v24h32v42h45v-30h22v-34h30v45h35v28h31v-46h27v-59h28v-30h34v44h26v58h26v28h49v-35h36v27h29v52h80v110H250"
        fill={p[1]}
      />
      <path
        d="m680 140 30-65h20v47h18v45m-339-14 29-66h26v49h21v36"
        fill="#f4ead3"
        opacity=".6"
      />
      <path
        d="M280 249h106v-32h76v15h93v-35h90v28h107v-24h99v31h115v-20h134v190H280"
        fill={p[2]}
      />
      <path
        d="M0 319h165v-30h139v-18h132v32h107v-12h98v46h105v-45h112v-27h242v135H0"
        fill={p[3]}
      />
      <path
        d="M790 230h38v34h-62v24h-68v24h42v26h-56v20h-90v42H408v-24h83v-32h-30v-19h119v-33h69v-33h74v-29z"
        fill={`url(#${key}-water)`}
      />
      <g opacity=".45" fill="#e4e6bf">
        <rect x="695" y="269" width="65" height="3" />
        <rect x="658" y="301" width="40" height="3" />
        <rect x="528" y="353" width="93" height="3" />
        <rect x="451" y="391" width="65" height="3" />
      </g>
      <g>
        {trees.map((t, i) => (
          <g key={i} transform={`translate(${t.x} ${t.y})`}>
            <rect x="-3" y="-6" width="6" height={t.size * 0.9} fill={p[4]} />
            <path
              d={`M${-t.size} -8h${t.size * 2}v${-t.size * 0.8}h${-t.size * 0.3}v${-t.size * 0.55}h${-t.size * 1.4}v${t.size * 0.55}h${-t.size * 0.3}z`}
              fill={i % 3 === 0 ? "#90a570" : p[3]}
            />
            <rect
              x={-t.size}
              y={-t.size * 1.35 - 8}
              width={t.size * 1.4}
              height={t.size * 0.45}
              fill={p[2]}
              opacity=".7"
            />
          </g>
        ))}
      </g>
      <g transform="translate(910 236)">
        <path d="M0 0h64v57H0z" fill="#ba9465" />
        <path d="m-9 1 40-36L73 1z" fill="#655b49" />
        <rect x="11" y="17" width="15" height="15" fill="#f8d990" />
        <rect x="42" y="24" width="13" height="33" fill="#75654c" />
        <path d="M-9 1h82M0 41h64" stroke="#8c744f" strokeWidth="3" />
      </g>
      <g fill="#d8bb7b">
        {Array.from({ length: 20 }, (_, i) => (
          <rect
            key={i}
            x={720 + ((i * 91) % 370)}
            y={350 + ((i * 17) % 45)}
            width="4"
            height="6"
          />
        ))}
      </g>
    </svg>
  );
}
