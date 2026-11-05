// MSVC-ABI fixture, independent of Windows SDK/CRT.
struct ImVec2 {
 float x,y;
 constexpr ImVec2():x(0),y(0){}
 constexpr ImVec2(float a,float b):x(a),y(b){}
};
using measure_fn=ImVec2(*)(const char*,const char*,bool,float);
static ImVec2 measure(const char *s,const char *end,bool hide,float wrap){
 unsigned n=0;
 while(s && s[n] && (!end || s+n<end)){if(hide&&s[n]=='#'&&s[n+1]=='#')break;++n;}
 return ImVec2(static_cast<float>(n),wrap);
}
extern "C" void *zh_fixture_measure(){return reinterpret_cast<void *>(&measure);}
extern "C" void zh_fixture_call(void *fn,const char *s,const char *end,bool hide,float wrap,float *x,float *y){
 auto v=reinterpret_cast<measure_fn>(fn)(s,end,hide,wrap);*x=v.x;*y=v.y;
}
