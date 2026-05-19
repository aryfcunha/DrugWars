// Cityscape — references public/cityscape.svg, generated from reference.png
// via scripts/build_cityscape.py. To regenerate: py scripts/build_cityscape.py

export function Cityscape() {
  return (
    <img
      src={`${import.meta.env.BASE_URL}cityscape.svg`}
      alt="NYC noir cityscape"
      style={{
        width: '100%',
        height: 'auto',
        display: 'block',
        imageRendering: 'pixelated',
      }}
      draggable={false}
    />
  );
}
