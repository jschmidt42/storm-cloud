varying highp vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform bool uSwizzle;

void main(void) {
	gl_FragColor = texture2D(uSampler, vec2(vTextureCoord.s, vTextureCoord.t));
}
