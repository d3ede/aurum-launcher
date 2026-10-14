#define UNICODE
#define _UNICODE
#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>
#include <dwmapi.h>
#include <gdiplus.h>
#include <stdint.h>

// Small NSIS presentation plugin. It owns no installation, registry or file logic.
struct Stack { Stack* next; wchar_t text[1]; };
static HWND rootWindow;
static HWND closeWindow;
static ULONG_PTR drawingToken;
static const COLORREF canvas=RGB(227,229,220), ink=RGB(45,57,47), muted=RGB(101,113,95);
static const COLORREF gold=RGB(236,201,108), hoverGold=RGB(242,211,130), surface=RGB(241,243,235);
static const UINT_PTR subclassId=0xA012;
static const wchar_t* roleKey=L"AurumInstallerRole";
static const wchar_t* hoverKey=L"AurumInstallerHover";

static int popInt(Stack** top) {
  if (!top || !*top) return 0;
  Stack* entry=*top; int value=_wtoi(entry->text); *top=entry->next;
  GlobalFree(entry); return value;
}
static int scale(HWND window,int value) {
  HMODULE user=GetModuleHandleW(L"user32.dll");
  typedef UINT(WINAPI* GetDpi)(HWND);
  GetDpi fn=reinterpret_cast<GetDpi>(GetProcAddress(user,"GetDpiForWindow"));
  return MulDiv(value,fn?fn(window):96,96);
}
static void roundedWindow(HWND window,int radius) {
  RECT r;GetWindowRect(window,&r);
  HRGN region=CreateRoundRectRgn(0,0,r.right-r.left+1,r.bottom-r.top+1,radius,radius);
  if(!SetWindowRgn(window,region,TRUE))DeleteObject(region);
}
static void fillRound(HDC dc,const RECT& rect,COLORREF color,int radius) {
  HBRUSH brush=CreateSolidBrush(color);HGDIOBJ oldBrush=SelectObject(dc,brush);
  HGDIOBJ oldPen=SelectObject(dc,GetStockObject(NULL_PEN));
  RoundRect(dc,rect.left,rect.top,rect.right,rect.bottom,radius,radius);
  SelectObject(dc,oldPen);SelectObject(dc,oldBrush);DeleteObject(brush);
}
static void renderClose(HWND window,HDC dc,const RECT& rect,COLORREF background,bool disabled) {
  if(!drawingToken) {
    Gdiplus::GdiplusStartupInput input;
    Gdiplus::GdiplusStartup(&drawingToken,&input,nullptr);
  }
  Gdiplus::Graphics graphics(dc);
  graphics.SetSmoothingMode(Gdiplus::SmoothingModeAntiAlias);
  graphics.SetPixelOffsetMode(Gdiplus::PixelOffsetModeHalf);
  const float ratio=scale(window,96)/96.0f;
  const float cx=(rect.left+rect.right)/2.0f,cy=(rect.top+rect.bottom)/2.0f;
  const LONG width=rect.right-rect.left,height=rect.bottom-rect.top;
  const float diameter=static_cast<float>(width<height?width:height)-2*ratio;
  Gdiplus::SolidBrush brush(Gdiplus::Color(255,GetRValue(background),GetGValue(background),GetBValue(background)));
  graphics.FillEllipse(&brush,cx-diameter/2,cy-diameter/2,diameter,diameter);
  COLORREF foreground=disabled?muted:ink;
  Gdiplus::Pen pen(Gdiplus::Color(255,GetRValue(foreground),GetGValue(foreground),GetBValue(foreground)),2*ratio);
  pen.SetStartCap(Gdiplus::LineCapRound);pen.SetEndCap(Gdiplus::LineCapRound);
  const float arm=5*ratio;
  graphics.DrawLine(&pen,cx-arm,cy-arm,cx+arm,cy+arm);
  graphics.DrawLine(&pen,cx+arm,cy-arm,cx-arm,cy+arm);
}
static void renderButton(const DRAWITEMSTRUCT& d) {
  int role=static_cast<int>(reinterpret_cast<INT_PTR>(GetPropW(d.hwndItem,roleKey)));
  if(!role)return;
  bool hover=GetPropW(d.hwndItem,hoverKey)!=nullptr;
  bool disabled=(d.itemState&ODS_DISABLED)!=0;
  HBRUSH canvasBrush=CreateSolidBrush(canvas);
  FillRect(d.hDC,&d.rcItem,canvasBrush);DeleteObject(canvasBrush);
  COLORREF background=role==1?(hover?hoverGold:gold):role==2?surface:canvas;
  if(role==3)background=hover?RGB(217,188,166):RGB(205,213,192);
  if(role==3 && (d.itemState&ODS_SELECTED))background=RGB(202,164,139);
  if(role==5 && hover)background=RGB(218,223,210);
  if(role==3)renderClose(d.hwndItem,d.hDC,d.rcItem,background,disabled);
  else fillRound(d.hDC,d.rcItem,background,scale(d.hwndItem,12));
  SetBkMode(d.hDC,TRANSPARENT);SetTextColor(d.hDC,disabled?muted:ink);
  HFONT font=reinterpret_cast<HFONT>(SendMessageW(d.hwndItem,WM_GETFONT,0,0));
  HGDIOBJ oldFont=SelectObject(d.hDC,font);
  if(role!=3) {
    wchar_t label[512];GetWindowTextW(d.hwndItem,label,512);RECT text=d.rcItem;
    DrawTextW(d.hDC,label,-1,&text,DT_CENTER|DT_VCENTER|DT_SINGLELINE|DT_END_ELLIPSIS);
  }
  if(d.itemState&ODS_FOCUS) {
    RECT focus=d.rcItem;InflateRect(&focus,-scale(d.hwndItem,3),-scale(d.hwndItem,3));
    DrawFocusRect(d.hDC,&focus);
  }
  SelectObject(d.hDC,oldFont);
}
static void renderCheckbox(HWND window) {
  PAINTSTRUCT paint;HDC dc=BeginPaint(window,&paint);RECT rect;GetClientRect(window,&rect);
  HBRUSH background=CreateSolidBrush(canvas);FillRect(dc,&rect,background);DeleteObject(background);
  int size=scale(window,17),left=scale(window,1),top=(rect.bottom-size)/2;
  RECT box={left,top,left+size,top+size};
  bool checked=SendMessageW(window,BM_GETCHECK,0,0)==BST_CHECKED;
  fillRound(dc,box,checked?gold:surface,scale(window,5));
  HPEN pen=CreatePen(PS_SOLID,scale(window,1),checked?RGB(191,158,73):RGB(161,171,148));
  HGDIOBJ oldPen=SelectObject(dc,pen),oldBrush=SelectObject(dc,GetStockObject(NULL_BRUSH));
  RoundRect(dc,box.left,box.top,box.right,box.bottom,scale(window,5),scale(window,5));
  SelectObject(dc,oldPen);DeleteObject(pen);
  if(checked) {
    pen=CreatePen(PS_SOLID,scale(window,2),ink);oldPen=SelectObject(dc,pen);
    MoveToEx(dc,left+scale(window,4),top+scale(window,8),nullptr);
    LineTo(dc,left+scale(window,7),top+scale(window,11));
    LineTo(dc,left+scale(window,13),top+scale(window,5));
    SelectObject(dc,oldPen);DeleteObject(pen);
  }
  SelectObject(dc,oldBrush);
  wchar_t label[512];GetWindowTextW(window,label,512);rect.left=left+size+scale(window,10);
  HFONT font=reinterpret_cast<HFONT>(SendMessageW(window,WM_GETFONT,0,0));
  HGDIOBJ oldFont=SelectObject(dc,font);SetBkMode(dc,TRANSPARENT);
  SetTextColor(dc,IsWindowEnabled(window)?ink:muted);
  DrawTextW(dc,label,-1,&rect,DT_LEFT|DT_VCENTER|DT_SINGLELINE|DT_END_ELLIPSIS);
  if(GetFocus()==window)DrawFocusRect(dc,&rect);
  SelectObject(dc,oldFont);EndPaint(window,&paint);
}
static LRESULT CALLBACK paneProc(HWND window,UINT message,WPARAM w,LPARAM l,UINT_PTR id,DWORD_PTR data) {
  int role=static_cast<int>(reinterpret_cast<INT_PTR>(GetPropW(window,roleKey)));
  if(message==WM_DRAWITEM) {
    const DRAWITEMSTRUCT* item=reinterpret_cast<const DRAWITEMSTRUCT*>(l);
    if(item && GetPropW(item->hwndItem,roleKey)){renderButton(*item);return TRUE;}
  }
  if(role==4 && message==WM_PAINT){renderCheckbox(window);return 0;}
  if(role==3 && message==WM_PAINT) {
    PAINTSTRUCT paint;HDC dc=BeginPaint(window,&paint);
    DRAWITEMSTRUCT item={};item.hwndItem=window;item.hDC=dc;
    GetClientRect(window,&item.rcItem);
    if(!IsWindowEnabled(window))item.itemState|=ODS_DISABLED;
    if(GetFocus()==window)item.itemState|=ODS_FOCUS;
    if(SendMessageW(window,BM_GETSTATE,0,0)&BST_PUSHED)item.itemState|=ODS_SELECTED;
    renderButton(item);EndPaint(window,&paint);return 0;
  }
  if(role==6 && message==WM_LBUTTONDOWN) {
    ReleaseCapture();SendMessageW(rootWindow,WM_NCLBUTTONDOWN,HTCAPTION,0);return 0;
  }
  if(message==WM_MOUSEMOVE && role>0) {
    if(!GetPropW(window,hoverKey)) {
      SetPropW(window,hoverKey,reinterpret_cast<HANDLE>(1));
      TRACKMOUSEEVENT track={sizeof(track),TME_LEAVE,window,0};TrackMouseEvent(&track);
      InvalidateRect(window,nullptr,FALSE);
    }
  }
  if(message==WM_MOUSELEAVE){RemovePropW(window,hoverKey);InvalidateRect(window,nullptr,FALSE);}
  if(message==WM_SETCURSOR && (role==1||role==2||role==3||role==4||role==5)) {
    SetCursor(LoadCursorW(nullptr,IDC_HAND));return TRUE;
  }
  if(window==rootWindow && message==WM_NCHITTEST) {
    POINT point={GET_X_LPARAM(l),GET_Y_LPARAM(l)};ScreenToClient(window,&point);
    RECT rect;GetClientRect(window,&rect);
    if(point.y<scale(window,18) && point.x<rect.right-scale(window,55))return HTCAPTION;
  }
  if(message==WM_NCDESTROY) {
    RemovePropW(window,roleKey);RemovePropW(window,hoverKey);RemoveWindowSubclass(window,paneProc,id);
  }
  LRESULT result=DefSubclassProc(window,message,w,l);
  if(role==0 && IsWindow(closeWindow) && IsWindowVisible(closeWindow) &&
     (message==WM_WINDOWPOSCHANGED || (message==WM_SHOWWINDOW && w))) {
    SetWindowPos(closeWindow,HWND_TOP,0,0,0,0,SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);
    RedrawWindow(closeWindow,nullptr,nullptr,RDW_INVALIDATE|RDW_UPDATENOW);
  }
  if(role==4 && (message==BM_SETCHECK||message==WM_LBUTTONUP||message==WM_KEYUP||message==WM_SETFOCUS||message==WM_KILLFOCUS))
    InvalidateRect(window,nullptr,FALSE);
  return result;
}
static void style(HWND window,int role) {
  if(role==3)closeWindow=window;
  SetPropW(window,roleKey,reinterpret_cast<HANDLE>(static_cast<INT_PTR>(role)));
  SetWindowSubclass(window,paneProc,subclassId,0);
  HWND parent=GetParent(window);
  SetWindowSubclass(parent,paneProc,subclassId,0);
  // Page siblings must not paint over the overlapping close control.
  SetWindowLongPtrW(parent,GWL_STYLE,GetWindowLongPtrW(parent,GWL_STYLE)|WS_CLIPSIBLINGS);
  SetWindowLongPtrW(window,GWL_STYLE,GetWindowLongPtrW(window,GWL_STYLE)|WS_CLIPSIBLINGS);
  if(role==1||role==2||role==3||role==5) {
    LONG_PTR style=GetWindowLongPtrW(window,GWL_STYLE);
    SetWindowLongPtrW(window,GWL_STYLE,(style&~BS_TYPEMASK)|BS_OWNERDRAW);
  }
  InvalidateRect(window,nullptr,TRUE);
}
#define ENTRY(name) extern "C" __declspec(dllexport) void __cdecl name(HWND parent,int,wchar_t*,Stack** stack,void*)
ENTRY(Initialize) {
  rootWindow=reinterpret_cast<HWND>(static_cast<INT_PTR>(popInt(stack)));
  LONG_PTR flags=GetWindowLongPtrW(rootWindow,GWL_STYLE);
  flags&=~(WS_CAPTION|WS_BORDER|WS_DLGFRAME|WS_THICKFRAME|WS_SYSMENU|WS_MINIMIZEBOX|WS_MAXIMIZEBOX);
  SetWindowLongPtrW(rootWindow,GWL_STYLE,flags|WS_POPUP|WS_CLIPCHILDREN);
  SetWindowPos(rootWindow,nullptr,0,0,0,0,SWP_FRAMECHANGED|SWP_NOSIZE|SWP_NOMOVE|SWP_NOZORDER);
  SetWindowSubclass(rootWindow,paneProc,subclassId,0);
  roundedWindow(rootWindow,scale(rootWindow,20));
  int preference=2;DwmSetWindowAttribute(rootWindow,33,&preference,sizeof(preference));
}
ENTRY(Button) {HWND control=reinterpret_cast<HWND>(static_cast<INT_PTR>(popInt(stack)));int role=popInt(stack);style(control,role);}
ENTRY(Checkbox) {style(reinterpret_cast<HWND>(static_cast<INT_PTR>(popInt(stack))),4);}
ENTRY(DragPane) {style(reinterpret_cast<HWND>(static_cast<INT_PTR>(popInt(stack))),6);}
ENTRY(Edit) {
  HWND control=reinterpret_cast<HWND>(static_cast<INT_PTR>(popInt(stack)));
  SetWindowLongPtrW(control,GWL_STYLE,GetWindowLongPtrW(control,GWL_STYLE)&~WS_BORDER);
  SetWindowLongPtrW(control,GWL_EXSTYLE,GetWindowLongPtrW(control,GWL_EXSTYLE)&~WS_EX_CLIENTEDGE);
  SetWindowPos(control,nullptr,0,0,0,0,SWP_FRAMECHANGED|SWP_NOSIZE|SWP_NOMOVE|SWP_NOZORDER);
  SendMessageW(control,EM_SETMARGINS,EC_LEFTMARGIN|EC_RIGHTMARGIN,MAKELPARAM(scale(control,10),scale(control,10)));
  roundedWindow(control,scale(control,10));
}
