/*
 * Atmosphere shell: a back-facing sphere, additively blended. Brightest just outside the
 * surface, fading outward, only where the sun reaches, shifting from blue to a warm band
 * along the terminator.
 *
 * Ported verbatim from VakOps/station-portfolio/src/shaders/atmosphere.js.
 */
export const atmosphereShader = {
  vertex: /* glsl */ `
    varying vec3 vN; varying vec3 vP; varying vec3 vWN;
    void main() {
      vN = normalize(normalMatrix * normal);
      vWN = normalize(mat3(modelMatrix) * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vP = mv.xyz;
      gl_Position = projectionMatrix * mv;
    }`,
  fragment: /* glsl */ `
    uniform vec3 color; uniform vec3 twilight; uniform float opacity; uniform vec3 sunDir;
    varying vec3 vN; varying vec3 vP; varying vec3 vWN;
    void main() {
      float d = abs(dot(normalize(vN), normalize(-vP)));
      float limb = pow(smoothstep(0.0, 0.5, d), 1.6);
      float NdotL = dot(normalize(vWN), sunDir);
      float lit = clamp(NdotL * 1.4 + 0.5, 0.0, 1.0);
      float tw = 1.0 - smoothstep(0.0, 0.16, abs(NdotL));
      vec3 c = mix(color, twilight, tw * 0.4);
      gl_FragColor = vec4(c * limb * lit * opacity, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};
