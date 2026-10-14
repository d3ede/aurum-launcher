// In-memory rendering regression test. No desktop windows or input automation.
#include "../aurum-ui.cpp"
#include <stdio.h>
#include <stdlib.h>
#include <math.h>

static int failures;
static void check(bool condition,const char* message) {
  if(!condition){fprintf(stderr,"FAIL: %s\n",message);++failures;}
}
static int channelDifference(DWORD a,DWORD b) {
  int largest=0;
  for(int shift=0;shift<24;shift+=8) {
    int difference=abs(static_cast<int>((a>>shift)&255)-static_cast<int>((b>>shift)&255));
    if(difference>largest)largest=difference;
  }
  return largest;
}
int main() {
  HWND parent=CreateWindowExW(0,L"STATIC",L"",0,0,0,0,0,HWND_MESSAGE,nullptr,nullptr,nullptr);
  HWND button=CreateWindowExW(0,L"BUTTON",L"Close",WS_CHILD,0,0,34,34,parent,nullptr,nullptr,nullptr);
  check(parent && button,"message-only test controls were created");
  rootWindow=parent;style(button,3);
  check((GetWindowLongPtrW(parent,GWL_STYLE)&WS_CLIPSIBLINGS)!=0,"page siblings clip the close control");
  check((GetWindowLongPtrW(button,GWL_STYLE)&WS_CLIPSIBLINGS)!=0,"button clips overlapping siblings");
  const int sizes[]={34,35,43,51,68};
  for(int size : sizes) {
    BITMAPINFO info={};info.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth=size;info.bmiHeader.biHeight=-size;
    info.bmiHeader.biPlanes=1;info.bmiHeader.biBitCount=32;info.bmiHeader.biCompression=BI_RGB;
    DWORD* pixels=nullptr;HBITMAP bitmap=CreateDIBSection(nullptr,&info,DIB_RGB_COLORS,reinterpret_cast<void**>(&pixels),nullptr,0);
    HDC dc=CreateCompatibleDC(nullptr);HGDIOBJ previous=SelectObject(dc,bitmap);
    RECT rect={0,0,size,size};DRAWITEMSTRUCT item={};item.hwndItem=button;item.hDC=dc;item.rcItem=rect;
    RemovePropW(button,hoverKey);
    renderButton(item);GdiFlush();
    check(GetPropW(button,hoverKey)==nullptr,"initial drawing requires no hover state");
    int dark=0;double weight=0,weightedX=0,weightedY=0;
    for(int y=0;y<size;++y)for(int x=0;x<size;++x) {
      DWORD pixel=pixels[y*size+x];
      if((pixel&255)<100 && ((pixel>>8)&255)<100 && ((pixel>>16)&255)<100)++dark;
      int shade=180-static_cast<int>((pixel>>8)&255);
      if(shade>0){weight+=shade;weightedX+=x*shade;weightedY+=y*shade;}
    }
    check(dark>=20,"the close glyph is visible on its first render");
    const double center=(size-1)/2.0;
    const bool centered=fabs(weightedX/weight-center)<0.15 && fabs(weightedY/weight-center)<0.15;
    if(!centered)fprintf(stderr,"size=%d, centroid=%.3f,%.3f, expected=%.3f\n",size,weightedX/weight,weightedY/weight,center);
    check(centered,"crossed strokes have a balanced visual center");
    DWORD idle=pixels[(size/2)*size+3];
    SetPropW(button,hoverKey,reinterpret_cast<HANDLE>(1));
    renderButton(item);GdiFlush();
    check(channelDifference(idle,pixels[(size/2)*size+3])>10,"hover feedback differs from the initial visible button");
    SelectObject(dc,previous);DeleteDC(dc);DeleteObject(bitmap);
  }
  DestroyWindow(parent);
  if(drawingToken)Gdiplus::GdiplusShutdown(drawingToken);
  if(failures)return 1;
  puts("Close button rendering passed: initial visibility, symmetry at five sizes, clipping and hover feedback.");
  return 0;
}
