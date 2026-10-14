export function TerrainPattern() {
  return (
    <svg
      className="terrain-pattern"
      viewBox="0 0 1000 220"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <path
          key={i}
          d={`M ${370 + i * 18} -30 C ${240 + i * 35} 90, ${770 - i * 12} 5, ${610 + i * 33} 140 S ${830 + i * 25} 240, 1080 ${130 + i * 20}`}
        />
      ))}
      {[0, 1, 2, 3].map((i) => (
        <path
          key={`b${i}`}
          d={`M ${770 + i * 25} -40 Q ${640 + i * 20} 90 ${910 + i * 18} 120 T 1100 280`}
        />
      ))}
    </svg>
  );
}

export function SidebarPattern() {
  return (
    <svg
      className="sidebar-pattern"
      viewBox="0 0 214 380"
      fill="none"
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4, 5, 6].map((line) => (
        <path
          key={line}
          d={`M -30 ${354 + line * 13} C 24 ${286 + line * 11}, 84 ${225 + line * 10}, 242 ${108 + line * 8}`}
        />
      ))}
      {[
        [96, 225, 10],
        [164, 236, 6],
        [174, 249, 11],
        [186, 261, 8],
        [162, 272, 10],
        [174, 284, 7],
        [149, 296, 10],
        [81, 324, 13],
        [55, 339, 6],
      ].map(([x, y, size], index) => (
        <rect key={index} x={x} y={y} width={size} height={size} />
      ))}
    </svg>
  );
}

export function HomePattern() {
  return (
    <svg
      className="home-pattern"
      viewBox="0 0 1000 260"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4, 5, 6].map((line) => (
        <path
          key={`top-${line}`}
          d={`M ${380 + line * 13} -25 C ${470 + line * 8} 35, ${462 + line * 13} 80, ${575 + line * 12} 91 S ${790 + line * 12} 122, ${835 + line * 19} 285`}
        />
      ))}
      {[0, 1, 2, 3, 4, 5].map((line) => (
        <path
          key={`bottom-${line}`}
          d={`M -25 ${110 + line * 11} C 24 ${233 + line * 6}, 158 ${196 + line * 9}, 245 ${205 + line * 9} S ${389 + line * 7} 240, ${450 + line * 16} 290`}
        />
      ))}
      {[
        [887, 28, 8],
        [899, 39, 12],
        [916, 56, 7],
        [879, 57, 7],
        [922, 72, 11],
        [466, 222, 9],
        [480, 208, 6],
        [494, 232, 11],
      ].map(([x, y, size], index) => (
        <rect key={index} x={x} y={y} width={size} height={size} />
      ))}
    </svg>
  );
}
