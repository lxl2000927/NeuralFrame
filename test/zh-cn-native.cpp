#include "../overlay/zh-cn-overlay.cpp"
#include <cassert>
extern "C" void *zh_fixture_measure();
extern "C" void zh_fixture_call(void *,const char *,const char *,bool,float,float *,float *);
static std::string clipboard;
static void copy_text(const char *s){clipboard=s?s:"";}
static const char *choice(void *,int index){return index==0?"General":"Latency";}
static bool combo_get(const char *label,int *current,const char *(*get)(void *,int),void *data,int count,int height){
 assert(std::string(label).find("###")!=std::string::npos);
 assert(count==2&&height==7&&*current==0);
 assert(std::string(get(data,0))=="常规");assert(std::string(get(data,1))=="延迟");
 *current=1;return true;
}
static bool combo_zero(const char *,int *current,const char *s,int height){
 assert(height==8);std::vector<std::string> values;
 for(auto p=s;*p;p+=strlen(p)+1)values.emplace_back(p);
 assert((values==std::vector<std::string>{"常规","质量","延迟","诊断"}));
 assert(*current==1);*current=3;return true;
}
static const char *format(const char *fmt,...){va_list a;va_start(a,fmt);const char *v=format_and_translate_v(fmt,a);va_end(a);return v;}
int main(){
 assert(std::string(translate_plain("Waiting for frame generation"))=="等待帧生成");
 assert(std::string(translate_widget_label("General###persistent"))=="常规###persistent");
 assert(std::string(translate_widget_label("##hidden"))=="##hidden");
 assert(std::string(format("Game request: %ux.",4u))=="游戏请求：4 倍。");
 assert(std::string(format("Renderer detected by ReShade: %s%s","Direct3D 12",""))=="ReShade 检测到的渲染器：Direct3D 12");
 g_orig.SetClipboardText=copy_text;
 std::string raw="D:\\Games\\General\\Quality.ini\nForceMultiplier=4";
 hook_SetClipboardText(raw.c_str());assert(clipboard==raw);
 std::string report="MFG Unlock Diagnostics\nRenderer: Direct3D 12\n";
 for(int i=0;i<200;i++)report+="Estimated rendered/source FPS: 52\nEffective request: Not observed\n";
 report+="Quality issue mask: 0x1234\nEND_MARKER";
 hook_SetClipboardText(report.c_str());
 assert(clipboard.find("多帧生成解锁诊断")==0);
 assert(clipboard.find("估算渲染／原始帧率：52")!=std::string::npos);
 assert(clipboard.find("有效请求：未观察到")!=std::string::npos);
 assert(clipboard.find("0x1234")!=std::string::npos);
 assert(clipboard.size()>4096&&clipboard.substr(clipboard.size()-10)=="END_MARKER");
 g_orig.Combo3=combo_get;g_orig.Combo2=combo_zero;
 int current=0;assert(hook_Combo3("General",&current,choice,nullptr,2,7)&&current==1);
 assert(hook_Combo2("Quality",&current,"General\0Quality\0Latency\0Diagnostics\0",8)&&current==3);
 void *hook=zh_measure_hook(zh_fixture_measure());float x=0,y=0;
 zh_fixture_call(hook,"General###persistent",nullptr,true,123.f,&x,&y);
 assert(x==6.f&&y==123.f); // 2 Chinese UTF-8 characters, measured through MSVC ABI.
 const char bounded[]="GeneralNOT_INCLUDED";
 zh_fixture_call(hook,bounded,bounded+7,false,77.f,&x,&y);assert(x==6.f&&y==77.f);
 zh_fixture_call(hook,"unknown",nullptr,false,-1.f,&x,&y);assert(x==7.f&&y==-1.f);
 puts("PASS: translations, IDs, printf, long reports, clipboard scope, combo values and MSVC text measurement ABI");
}
