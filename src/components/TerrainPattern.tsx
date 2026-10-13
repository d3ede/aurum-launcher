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
