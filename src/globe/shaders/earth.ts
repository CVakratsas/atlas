/*
 * Earth surface and cloud shaders. Ported from VakOps/station-portfolio/src/shaders/earth.js.
 *
 * Both are lit by uSunDir in world space, independent of the scene lights, so the
 * terminator can be placed deliberately across the visible disc rather than wherever a
 * light happens to sit.
 *
 * The one addition for Atlas is `overlayMap`: an equirectangular RGBA canvas carrying the
 * country colours. It is composited two ways on purpose — tinted into the diffuse so the
 * terrain still reads through it, and added as a small emissive term so that a country you
 * have found is still visible on the night side of the planet. Without that second term
 * half the board goes dark and the game becomes unplayable at the terminator.
 */

const common = /* glsl */ `
  varying vec2 vUv; varying vec3 vWN; varying vec3 vWP;
`;

export const earthSurfaceShader = {
  vertex: /* glsl */ `
    ${common}
    void main() {
      vUv = uv;
      vWN = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWP = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragment: /* glsl */ `
    ${common}
    uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D cloudMap;
    uniform sampler2D overlayMap;
    uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uNight; uniform float uCloudShift;
    uniform vec3 uAtmoColor; uniform vec3 uTwilightColor; uniform float uHasClouds;
    uniform float uOverlayTint; uniform float uOverlayGlow;

    void main() {
      vec3 N = normalize(vWN);
      vec3 V = normalize(cameraPosition - vWP);
      vec3 L = normalize(uSunDir);
      float NdotL = dot(N, L);
      float NdotV = max(dot(N, V), 0.0);

      vec3 day = texture2D(dayMap, vUv).rgb;
      vec4 ov = texture2D(overlayMap, vUv);

      /* ocean where the day map is blue-dominant: smooth, so it catches the sun */
      float ocean = smoothstep(0.02, 0.16, day.b - max(day.r, day.g));

      /* the country colour tints the terrain rather than replacing it, so mountains and
         deserts still show through a highlighted country */
      vec3 ground = mix(day, ov.rgb, ov.a * uOverlayTint);

      vec2 cuv = vec2(vUv.x + uCloudShift, vUv.y);
      float cloudHere = texture2D(cloudMap, cuv).r * uHasClouds;
      float cloudShadow = 1.0 - 0.5 * texture2D(cloudMap, cuv + vec2(0.0028, -0.0016)).r * uHasClouds;

      float lit = smoothstep(-0.04, 0.22, NdotL);
      vec3 diffuse = ground * uSunColor * lit * cloudShadow;

      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 160.0) * ocean * smoothstep(0.0, 0.25, NdotL) * 0.30;
      spec += pow(max(dot(N, H), 0.0), 12.0) * ocean * smoothstep(0.0, 0.25, NdotL) * 0.025;

      vec3 night = texture2D(nightMap, vUv).rgb;
      float dark = 1.0 - smoothstep(-0.18, 0.06, NdotL);
      vec3 cities = night * uNight * dark * (1.0 - 0.7 * cloudHere);

      float fres = pow(1.0 - NdotV, 3.6);
      float twilight = 1.0 - smoothstep(0.0, 0.16, abs(NdotL));
      vec3 atmo = mix(uAtmoColor, uTwilightColor, twilight * 0.40);
      vec3 rim = atmo * fres * (0.10 + 0.90 * smoothstep(-0.10, 0.25, NdotL)) * 0.55;

      /* emissive term: a found country stays legible on the unlit side */
      vec3 glow = ov.rgb * ov.a * uOverlayGlow;

      vec3 col = diffuse + spec * uSunColor + cities + rim + glow;
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export const earthCloudShader = {
  vertex: earthSurfaceShader.vertex,
  fragment: /* glsl */ `
    ${common}
    uniform sampler2D cloudMap; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uOpacity;
    uniform vec3 uTwilightColor;
    void main() {
      vec3 N = normalize(vWN);
      vec3 V = normalize(cameraPosition - vWP);
      vec3 L = normalize(uSunDir);
      float NdotL = dot(N, L);
      float c = texture2D(cloudMap, vUv).r;
      float lit = smoothstep(-0.06, 0.28, NdotL);
      float twilight = 1.0 - smoothstep(0.0, 0.25, abs(NdotL));
      vec3 col = mix(uSunColor, uTwilightColor * 1.4, twilight * 0.6) * (0.02 + 0.98 * lit);
      float edge = smoothstep(0.0, 0.25, dot(N, V));
      gl_FragColor = vec4(col, c * uOpacity * edge);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};
