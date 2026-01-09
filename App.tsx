import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Trip, Tab, DayPlan, Expense, ChecklistItem, ActivityType, ItineraryItem, ExpenseCategory, PaymentMethod, SplitType, Budget, Voucher, BookingDetails, AdvancedGuide } from './types';
import { fetchDestinationInfo, analyzeItinerary } from './services/geminiService';
import { Icons } from './components/Icons';
import LZString from 'lz-string';

// --- Static Data ---
const DEFAULT_CHECKLIST_ITEMS = [
    { category: '證件/金錢', items: ['護照 (效期6個月以上)', '簽證/入境許可', '機票/住宿憑證', '信用卡 (已開通海外)', '當地貨幣/現金', '旅遊保險單'] },
    { category: '電子產品', items: ['手機', '充電線/豆腐頭', '萬用轉接頭', '行動電源 (須手提)', '網卡/eSIM (已設定)'] },
    { category: '盥洗/藥品', items: ['牙刷/牙膏', '個人保養品', '常備藥 (感冒/腸胃/止痛)', '口罩/乾洗手', '面紙/濕紙巾'] },
    { category: '衣物', items: ['換洗衣物', '睡衣', '好走的鞋', '貼身衣物', '外套/雨具'] }
];

// --- Utility Functions ---

const generateId = () => Math.random().toString(36).substr(2, 9);

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' });
};

// Generic File Handler (Image Compress, PDF Raw)
const handleFileUpload = (file: File): Promise<{data: string, type: 'image' | 'pdf', name: string}> => {
    return new Promise((resolve, reject) => {
        const isPdf = file.type === 'application/pdf';
        
        if (isPdf) {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve({ data: reader.result as string, type: 'pdf', name: file.name });
            reader.onerror = reject;
        } else {
            // Compress Image
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target?.result as string;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 800;
                    const scaleSize = MAX_WIDTH / img.width;
                    canvas.width = MAX_WIDTH;
                    canvas.height = img.height * scaleSize;
                    
                    const ctx = canvas.getContext('2d');
                    ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve({ data: canvas.toDataURL('image/jpeg', 0.7), type: 'image', name: file.name });
                };
                img.onerror = (err) => reject(err);
            };
            reader.onerror = (err) => reject(err);
        }
    });
};

const compressImage = async (file: File) => (await handleFileUpload(file)).data; // Backward compatibility alias

// Map weather string to Icon
const getWeatherIcon = (weatherStr: string) => {
    if (!weatherStr) return Icons.Sun;
    const lower = weatherStr.toLowerCase();
    if (lower.includes('rain') || lower.includes('雨')) return Icons.Rain;
    if (lower.includes('cloud') || lower.includes('多雲') || lower.includes('陰')) return Icons.Cloud;
    return Icons.Sun;
};

// Calculate duration between two time strings (HH:MM)
const calculateDuration = (start: string, end?: string) => {
    if (!end || !start) return null;
    try {
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        let diff = endMin - startMin;
        if (diff < 0) diff += 24 * 60; // Handle over midnight
        const hours = Math.floor(diff / 60);
        const mins = diff % 60;
        return `${hours > 0 ? hours + 'h' : ''}${mins > 0 ? mins + 'm' : ''}`;
    } catch {
        return null;
    }
};

// --- Sub-Components ---

const LoadingSpinner = () => (
  <div className="flex justify-center items-center p-4">
    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-gold-500"></div>
  </div>
);

const Button = ({ children, onClick, variant = 'primary', className = '', icon: Icon, disabled = false }: any) => {
  const baseStyle = "flex items-center justify-center px-4 py-3 rounded-xl font-bold transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-lg shadow-lg no-print";
  const variants = {
    primary: "bg-gradient-to-r from-gold-400 to-gold-600 text-dark-bg hover:shadow-gold-500/20",
    secondary: "bg-dark-surface border border-gold-700/30 text-gold-400 hover:bg-gold-900/10",
    danger: "bg-red-900/20 border border-red-500/30 text-red-400",
    ghost: "bg-transparent text-gold-400 hover:text-gold-200"
  };
  
  return (
    <button onClick={onClick} disabled={disabled} className={`${baseStyle} ${variants[variant as keyof typeof variants]} ${className}`}>
      {Icon && <Icon className="mr-2" size={20} />}
      {children}
    </button>
  );
};

const Card = ({ children, className = '', style = {} }: any) => (
  <div className={`bg-dark-card border border-gold-500/20 rounded-2xl shadow-xl p-5 break-inside-avoid ${className}`} style={style}>
    {children}
  </div>
);

const Modal = ({ isOpen, onClose, title, children }: any) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-6 animate-fade-in no-print">
            <div className="bg-dark-card border border-gold-500 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                <div className="bg-gradient-to-r from-gold-600 to-gold-400 p-4 flex justify-between items-center shrink-0">
                    <h3 className="text-dark-bg font-bold text-lg font-serif">{title}</h3>
                    <button onClick={onClose} className="text-dark-bg hover:bg-white/20 rounded-full p-1"><Icons.Plus className="rotate-45" /></button>
                </div>
                <div className="p-6 overflow-y-auto custom-scrollbar">
                    {children}
                </div>
            </div>
        </div>
    );
};

// --- Itinerary Logic ---

const ITINERARY_TYPES: { type: ActivityType; label: string; icon: any; colorClass: string }[] = [
    { type: 'flight', label: '航班', icon: Icons.Plane, colorClass: 'bg-indigo-100 text-indigo-900 border-indigo-200' },
    { type: 'attraction', label: '景點', icon: Icons.Camera, colorClass: 'bg-purple-100 text-purple-900 border-purple-200' },
    { type: 'food', label: '餐廳', icon: Icons.Utensils, colorClass: 'bg-orange-100 text-orange-900 border-orange-200' },
    { type: 'transport', label: '交通', icon: Icons.Bus, colorClass: 'bg-sky-100 text-sky-900 border-sky-200' },
    { type: 'accommodation', label: '住宿', icon: Icons.Home, colorClass: 'bg-pink-100 text-pink-900 border-pink-200' },
    { type: 'other', label: '其他', icon: Icons.Sparkles, colorClass: 'bg-gray-100 text-gray-800 border-gray-200' },
];

const ItineraryView = ({ trip, updateTrip, isPrinting = false }: { trip: Trip; updateTrip: (t: Trip) => void, isPrinting?: boolean }) => {
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemForm, setItemForm] = useState<Partial<ItineraryItem>>({ time: '', endTime: '', activity: '', location: '', type: 'attraction', isImportant: false, alternatives: [] });
  const [newAlternative, setNewAlternative] = useState('');
  const [imageModalUrl, setImageModalUrl] = useState<string | null>(null);
  const [isMapView, setIsMapView] = useState(false);
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);

  useEffect(() => {
    if(!isMapView && !isPrinting) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [selectedDayIndex, isMapView, isPrinting]);

  // If printing, we render ALL days sequentially
  if (isPrinting) {
      return (
          <div className="space-y-8">
              {(trip.itinerary || []).map((day, idx) => (
                  <div key={idx} className="break-inside-avoid mb-8">
                      <h3 className="text-xl font-bold text-black border-b-2 border-gold-500 mb-4 pb-1">
                          Day {idx + 1} - {formatDate(day.date)}
                      </h3>
                      <div className="space-y-4 pl-4 border-l-2 border-gray-200 ml-2">
                          {(day.items || []).map(item => (
                              <div key={item.id} className="flex gap-4 mb-2">
                                  <div className="w-16 text-xs font-bold text-gray-600 pt-1">{item.time}</div>
                                  <div className="flex-1">
                                      <div className="font-bold text-black text-sm">{item.activity}</div>
                                      {item.location && <div className="text-xs text-gray-500">{item.location}</div>}
                                      {item.note && <div className="text-xs text-gray-400 mt-1 italic">{item.note}</div>}
                                  </div>
                              </div>
                          ))}
                          {day.items.length === 0 && <div className="text-xs text-gray-400 italic">本日無行程</div>}
                      </div>
                  </div>
              ))}
          </div>
      );
  }

  const jumpToToday = () => {
      const today = new Date().toISOString().split('T')[0];
      const idx = trip.itinerary.findIndex(day => day.date.startsWith(today));
      if (idx !== -1) {
          setSelectedDayIndex(idx);
          alert("已跳轉至今日行程");
      } else {
          alert("今日不在旅程日期範圍內");
      }
  }

  const openAddModal = () => {
      setModalMode('add');
      setItemForm({ time: '', endTime: '', activity: '', location: '', type: 'attraction', isImportant: false, alternatives: [], cost: 0, travelTime: '', travelMode: 'transit' });
      setIsModalOpen(true);
  };

  const openEditModal = (item: ItineraryItem) => {
      setModalMode('edit');
      setEditingItemId(item.id);
      setItemForm({ ...item });
      setIsModalOpen(true);
  };

  const handleSaveItem = () => {
      if (!itemForm.time || !itemForm.activity) return alert("請輸入時間與活動名稱");
      
      const newTrip = { ...trip };
      const currentItems = newTrip.itinerary[selectedDayIndex].items;
      let savedItem: ItineraryItem;

      if (modalMode === 'add') {
          savedItem = {
              id: generateId(),
              time: itemForm.time!,
              endTime: itemForm.endTime,
              activity: itemForm.activity!,
              location: itemForm.location || '',
              type: itemForm.type || 'attraction',
              isImportant: itemForm.isImportant,
              alternatives: itemForm.alternatives || [],
              bookingImage: itemForm.bookingImage,
              isCompleted: false,
              cost: Number(itemForm.cost) || 0,
              travelTime: itemForm.travelTime,
              travelMode: itemForm.travelMode,
          };
          currentItems.push(savedItem);
      } else {
          const index = currentItems.findIndex(i => i.id === editingItemId);
          if (index !== -1) {
              currentItems[index] = { ...currentItems[index], ...itemForm } as ItineraryItem;
              savedItem = currentItems[index];
          } else {
              return;
          }
      }
      
      currentItems.sort((a, b) => {
          if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
          return a.time.localeCompare(b.time);
      });

      // --- Auto Expense Logic ---
      const cost = Number(itemForm.cost) || 0;
      const itemId = savedItem.id;

      const mapTypeToCategory = (t: ActivityType): ExpenseCategory => {
          switch (t) {
              case 'flight': return 'flight';
              case 'attraction': return 'ticket';
              case 'food': return 'food';
              case 'transport': return 'transport';
              case 'accommodation': return 'accommodation';
              default: return 'other';
          }
      };
      
      const expenseIndex = newTrip.expenses.findIndex(e => e.itemId === itemId);
      const currentDate = newTrip.itinerary[selectedDayIndex].date;
      
      if (cost > 0) {
          if (expenseIndex >= 0) {
              // Update existing expense
              newTrip.expenses[expenseIndex] = {
                  ...newTrip.expenses[expenseIndex],
                  item: savedItem.activity,
                  twdAmount: cost, // Assume input is TWD/base currency for auto-add
                  category: mapTypeToCategory(savedItem.type),
                  date: currentDate
              };
          } else {
              // Create new expense
              newTrip.expenses.push({
                  id: generateId(),
                  itemId: itemId,
                  item: savedItem.activity,
                  foreignAmount: 0,
                  twdAmount: cost,
                  exchangeRate: 1,
                  currency: 'TWD',
                  category: mapTypeToCategory(savedItem.type),
                  paymentMethod: 'cash',
                  split: 'me',
                  date: currentDate
              });
          }
      } else if (expenseIndex >= 0) {
          // Remove expense if cost is set to 0 or cleared
          newTrip.expenses.splice(expenseIndex, 1);
      }

      updateTrip(newTrip);
      setIsModalOpen(false);
  };

  const removeActivity = (dayIndex: number, itemId: string) => {
    if(!confirm("確定刪除此行程?")) return;
    const newTrip = { ...trip };
    
    // Remove Item
    newTrip.itinerary[dayIndex].items = newTrip.itinerary[dayIndex].items.filter(i => i.id !== itemId);
    
    // Remove linked expense if exists
    const expenseIndex = newTrip.expenses.findIndex(e => e.itemId === itemId);
    if(expenseIndex >= 0) {
        newTrip.expenses.splice(expenseIndex, 1);
    }

    updateTrip(newTrip);
  };

  const toggleComplete = (itemId: string) => {
      const newTrip = { ...trip };
      const items = newTrip.itinerary[selectedDayIndex].items;
      const item = items.find(i => i.id === itemId);
      if (item) {
          item.isCompleted = !item.isCompleted;
          items.sort((a, b) => {
              if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
              return a.time.localeCompare(b.time);
          });
          updateTrip(newTrip);
      }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
      setDraggedItemIndex(index);
      e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
      e.preventDefault();
      if (draggedItemIndex === null || draggedItemIndex === dropIndex) return;

      const newTrip = { ...trip };
      const items = newTrip.itinerary[selectedDayIndex].items;
      
      const itemToMove = items[draggedItemIndex];
      items.splice(draggedItemIndex, 1);
      items.splice(dropIndex, 0, itemToMove);

      updateTrip(newTrip);
      setDraggedItemIndex(null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          compressImage(file).then(base64 => {
              setItemForm(prev => ({ ...prev, bookingImage: base64 }));
          });
      }
  };

  const addAlternative = () => {
      if (!newAlternative) return;
      setItemForm(prev => ({ ...prev, alternatives: [...(prev.alternatives || []), newAlternative] }));
      setNewAlternative('');
  };

  const currentDayPlan = trip.itinerary[selectedDayIndex];
  const dayWeather = trip.dailyWeather?.[selectedDayIndex] || trip.weather?.summary;

  const mapSrc = useMemo(() => {
      if (!currentDayPlan || currentDayPlan.items.length === 0) return null;
      const locations = currentDayPlan.items
          .filter(i => i.location)
          .map(i => encodeURIComponent(i.location))
          .join('/');
      
      const apiKey = process.env.API_KEY || ''; 
      
      if (locations.length === 0) return null;
      
      const first = currentDayPlan.items.find(i => i.location)?.location;
      const last = [...currentDayPlan.items].reverse().find(i => i.location)?.location;
      
      if (!first) return null;

      const origin = encodeURIComponent(first);
      const destination = last && last !== first ? encodeURIComponent(last) : origin;
      const waypoints = currentDayPlan.items
          .filter(i => i.location && i.location !== first && i.location !== last)
          .map(i => encodeURIComponent(i.location))
          .join('|');
          
      return `https://www.google.com/maps/embed/v1/directions?key=${apiKey}&origin=${origin}&destination=${destination}${waypoints ? `&waypoints=${waypoints}` : ''}`;
  }, [currentDayPlan]);

  return (
    <div className="pb-24 animate-fade-in">
       {/* Hero Section */}
       <div className="relative mb-4 rounded-2xl overflow-hidden shadow-lg bg-gradient-to-r from-gray-900 via-dark-card to-gray-900 border border-gold-500/30 p-5 flex justify-between items-center no-print">
           <div>
               <div className="text-gold-500 text-[10px] font-bold tracking-widest uppercase mb-1 flex items-center gap-1">
                   <Icons.Map size={10} />
                   目前旅程
               </div>
               <h2 className="text-2xl font-serif text-white font-bold leading-tight">{trip.destination}</h2>
               <p className="text-gray-400 text-xs mt-1 font-sans">{formatDate(currentDayPlan.date)}</p>
           </div>
           
           <div className="text-right bg-black/20 p-3 rounded-xl border border-white/5 backdrop-blur-sm min-w-[80px]">
               <div className="text-white text-xl font-bold flex flex-col items-center justify-center">
                   {(() => {
                       const wStr = dayWeather || '';
                       const WIcon = getWeatherIcon(wStr);
                       return <WIcon size={24} className="text-gold-400 mb-1" />;
                   })()}
                   <span>{dayWeather ? dayWeather.split(' ')[1] || '' : ''}</span>
               </div>
               <div className="text-[10px] text-gray-400 text-center mt-1">{dayWeather ? dayWeather.split(' ')[0] : '晴朗'}</div>
           </div>
       </div>

      {/* Date Navigation - HIDE IN PRINT */}
      <div className="sticky top-16 z-40 bg-dark-bg/95 backdrop-blur py-3 -mx-4 px-4 border-b border-gray-800 mb-6 flex items-center gap-2 no-print">
        <button onClick={jumpToToday} className="flex-shrink-0 w-10 h-full flex items-center justify-center bg-gold-500/10 text-gold-500 rounded-xl border border-gold-500/30">
            <Icons.Crosshair size={20} />
        </button>

        <div className="flex overflow-x-auto gap-3 no-scrollbar flex-1">
            {(trip.itinerary || []).map((day, idx) => {
                const wStr = trip.dailyWeather?.[idx] || '';
                const WIcon = getWeatherIcon(wStr);
                const isSelected = selectedDayIndex === idx;
                
                return (
                    <button
                        key={idx}
                        onClick={() => setSelectedDayIndex(idx)}
                        className={`flex-shrink-0 px-2 py-2 rounded-xl min-w-[70px] flex flex-col items-center transition-all border ${
                        isSelected 
                        ? 'bg-gold-500 text-black border-gold-500 shadow-lg shadow-gold-500/20' 
                        : 'bg-dark-surface text-gray-400 border-gray-700 hover:border-gold-500/50'
                        }`}
                    >
                        <div className="text-[10px] opacity-80 uppercase font-bold tracking-wide">第 {idx + 1} 天</div>
                        <div className="text-lg font-serif font-bold leading-none my-1">{new Date(day.date).getDate()}</div>
                        <div className={`mt-1 flex items-center gap-1 text-[10px] ${isSelected ? 'text-black/70' : 'text-gray-500'}`}>
                            <WIcon size={12} />
                            <span>{wStr.split(' ')[1]?.replace('°C', '°') || ''}</span>
                        </div>
                    </button>
                );
            })}
        </div>
      </div>
      
      {/* View Toggle - HIDE IN PRINT */}
      <div className="flex justify-end mb-4 px-2 no-print">
          <div className="bg-dark-surface p-1 rounded-lg border border-gray-700 inline-flex">
              <button onClick={() => setIsMapView(false)} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${!isMapView ? 'bg-gold-500 text-black' : 'text-gray-400 hover:text-white'}`}>列表</button>
              <button onClick={() => setIsMapView(true)} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${isMapView ? 'bg-gold-500 text-black' : 'text-gray-400 hover:text-white'}`}>地圖</button>
          </div>
      </div>

      {/* Content */}
      {isMapView ? (
          <div className="h-[60vh] rounded-2xl overflow-hidden border border-gray-700 relative bg-dark-card no-print">
              {process.env.API_KEY ? (
                 <iframe width="100%" height="100%" style={{ border: 0 }} loading="lazy" allowFullScreen src={mapSrc || ''} className="filter grayscale contrast-125 opacity-80 hover:opacity-100 transition-opacity"></iframe>
              ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6 text-center">
                      <Icons.Map size={48} className="mb-4 opacity-30" />
                      <p className="mb-2">請設定 API Key 以啟用互動式地圖</p>
                  </div>
              )}
          </div>
      ) : (
        <div className="relative pl-4">
            <div className="absolute left-[27px] top-4 bottom-0 w-0.5 bg-gradient-to-b from-gold-500 via-gray-700 to-gray-800 no-print"></div>
            <div className="space-y-2">
                {currentDayPlan.items.length === 0 ? (
                    <div className="ml-10 py-10 text-gray-500 border-2 border-dashed border-gray-800 rounded-xl text-center no-print"><p>本日尚無行程</p><p className="text-sm mt-2">點擊右下角新增</p></div>
                ) : (
                    currentDayPlan.items.map((item, index) => {
                        const typeConfig = ITINERARY_TYPES.find(t => t.type === item.type) || ITINERARY_TYPES[5];
                        const TypeIcon = typeConfig.icon;
                        const duration = calculateDuration(item.time, item.endTime);
                        const showConnector = index < currentDayPlan.items.length - 1 && item.location && currentDayPlan.items[index+1].location;
                        
                        return (
                            <React.Fragment key={item.id}>
                                <div 
                                    draggable={!item.isCompleted}
                                    onDragStart={(e) => handleDragStart(e, index)}
                                    onDragOver={(e) => handleDragOver(e, index)}
                                    onDrop={(e) => handleDrop(e, index)}
                                    className={`relative flex items-start gap-4 group transition-all duration-300 ${item.isCompleted ? 'opacity-50 grayscale' : ''} ${draggedItemIndex === index ? 'opacity-0' : ''}`}
                                >
                                    {/* Time Bubble */}
                                    <div className="relative z-10 flex flex-col items-center min-w-[50px] pt-1">
                                        <span className={`text-xs font-mono font-bold bg-dark-bg px-1 ${item.isImportant ? 'text-gold-500' : 'text-gray-400'}`}>{item.time}</span>
                                        {duration && <span className="text-[10px] text-gray-600 mt-0.5">{duration}</span>}
                                        <div className={`w-3 h-3 rounded-full border-2 border-dark-bg mt-1 ${item.isCompleted ? 'bg-gray-700' : (item.isImportant ? 'bg-gold-500' : 'bg-gray-500')}`}></div>
                                    </div>

                                    {/* Card */}
                                    <div className={`flex-1 rounded-2xl p-4 shadow-lg border relative overflow-hidden transition-transform active:scale-[0.98] 
                                        ${typeConfig.colorClass}
                                        ${item.isImportant ? '!border-gold-500 ring-2 ring-gold-500/50 shadow-gold-500/20' : ''} 
                                        ${item.isCompleted ? '!bg-gray-900 !border-gray-800 !text-gray-500' : ''}
                                    `}>
                                        <div className="flex justify-between items-start">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1 opacity-70 text-xs font-bold uppercase tracking-wider">
                                                    <TypeIcon size={12} />
                                                    {typeConfig.label}
                                                    {item.isImportant && <Icons.Star size={12} className="fill-gold-500 text-gold-500" />}
                                                </div>
                                                <h3 className={`text-lg font-bold leading-tight mb-2 ${item.isCompleted ? 'line-through text-gray-500' : ''}`}>{item.activity}</h3>
                                                
                                                <div className="flex flex-wrap gap-2 mt-2">
                                                    {item.location && (
                                                        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.location)}`} target="_blank" className="inline-flex items-center gap-1 bg-white/20 hover:bg-white/30 text-current px-3 py-1.5 rounded-lg text-xs font-bold transition-colors no-print"><Icons.Navigation size={12} />導航</a>
                                                    )}
                                                    {item.bookingImage && (
                                                        <button onClick={() => setImageModalUrl(item.bookingImage!)} className="inline-flex items-center gap-1 bg-white/20 hover:bg-white/30 text-current px-3 py-1.5 rounded-lg text-xs font-bold transition-colors no-print"><Icons.Image size={12} />憑證</button>
                                                    )}
                                                </div>

                                                {item.alternatives && item.alternatives.length > 0 && (
                                                    <details className="mt-3 text-xs opacity-80 cursor-pointer">
                                                        <summary className="flex items-center gap-1 font-bold text-current/70 hover:text-current">
                                                            {item.type === 'transport' ? <Icons.Clock size={12} /> : <Icons.Alert size={12} />}
                                                            {item.type === 'transport' ? `乘車時刻表備選 (${item.alternatives.length})` : `備案計畫 (${item.alternatives.length})`}
                                                        </summary>
                                                        <ul className="mt-2 pl-4 list-disc space-y-1">{item.alternatives.map((alt, idx) => (<li key={idx}>{alt}</li>))}</ul>
                                                    </details>
                                                )}
                                            </div>
                                            
                                            <div className="flex items-center gap-2 ml-2 flex-row no-print">
                                                {!item.isCompleted && (<div className="text-current opacity-30 cursor-grab p-1"><Icons.Grip size={16} /></div>)}
                                                <button onClick={() => toggleComplete(item.id)} className={`p-1 ${item.isCompleted ? 'text-green-500' : 'text-current opacity-30 hover:opacity-100'}`}>{item.isCompleted ? <Icons.CheckCircle size={18} className="fill-current text-white" /> : <Icons.Circle size={18} />}</button>
                                                <button onClick={() => openEditModal(item)} className="text-current opacity-30 hover:opacity-100 p-1"><Icons.Edit size={16} /></button>
                                                <button onClick={() => removeActivity(selectedDayIndex, item.id)} className="text-current opacity-30 hover:opacity-100 p-1"><Icons.Trash size={16} /></button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                {showConnector && !item.isCompleted && (
                                    <div className="ml-[27px] pl-8 py-4 relative border-l-2 border-dashed border-gray-700/50 flex items-center no-print">
                                        <div className="bg-dark-surface border border-gray-600 rounded-full px-2 py-1 text-[10px] text-gray-400 flex items-center gap-1">
                                            {item.travelMode === 'walking' ? <Icons.Footprints size={10} /> : <Icons.Bus size={10} />}
                                            {item.travelTime || '15 min'}
                                        </div>
                                    </div>
                                )}
                            </React.Fragment>
                        );
                    })
                )}
            </div>
        </div>
      )}

      {/* Floating Add Button - HIDE IN PRINT */}
      <div className="fixed bottom-24 right-6 z-40 no-print">
          <button onClick={openAddModal} className="bg-gold-500 text-dark-bg p-4 rounded-full shadow-lg shadow-gold-500/30 hover:scale-110 transition-transform"><Icons.Plus size={28} /></button>
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={modalMode === 'add' ? '新增行程' : '編輯行程'}>
          <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 mb-4">
                  {ITINERARY_TYPES.map(t => (
                      <button key={t.type} onClick={() => setItemForm({...itemForm, type: t.type})} className={`flex flex-col items-center justify-center p-2 rounded-lg border text-xs transition-colors ${itemForm.type === t.type ? 'bg-gold-500 text-dark-bg border-gold-500 font-bold' : 'bg-dark-surface text-gray-400 border-gray-700 hover:border-gray-500'}`}><t.icon size={20} className="mb-1" />{t.label}</button>
                  ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs text-gold-500 mb-1">開始時間</label><input type="time" value={itemForm.time} onChange={e => setItemForm({...itemForm, time: e.target.value})} className="w-full bg-dark-bg border border-gray-700 rounded-lg p-3 text-white focus:border-gold-500 outline-none" /></div>
                <div><label className="block text-xs text-gold-500 mb-1">結束時間 (選填)</label><input type="time" value={itemForm.endTime || ''} onChange={e => setItemForm({...itemForm, endTime: e.target.value})} className="w-full bg-dark-bg border border-gray-700 rounded-lg p-3 text-white focus:border-gold-500 outline-none" /></div>
              </div>
              <div><label className="block text-xs text-gold-500 mb-1">活動名稱</label><input value={itemForm.activity} onChange={e => setItemForm({...itemForm, activity: e.target.value})} placeholder="例如：參觀清水寺" className="w-full bg-dark-bg border border-gray-700 rounded-lg p-3 text-white focus:border-gold-500 outline-none" /></div>
              <div><label className="block text-xs text-gold-500 mb-1">地點 (用於導航/地圖)</label><input value={itemForm.location} onChange={e => setItemForm({...itemForm, location: e.target.value})} placeholder="例如：清水寺" className="w-full bg-dark-bg border border-gray-700 rounded-lg p-3 text-white focus:border-gold-500 outline-none" /></div>
              <div className="grid grid-cols-2 gap-3 p-3 bg-dark-surface rounded-lg border border-gray-700">
                  <div><label className="block text-xs text-gold-500 mb-1">費用 (自動記帳)</label><div className="flex items-center bg-dark-bg border border-gray-600 rounded"><span className="pl-2 text-xs text-gray-400">$</span><input type="number" value={itemForm.cost || ''} onChange={e => setItemForm({...itemForm, cost: parseFloat(e.target.value)})} className="w-full bg-transparent p-2 text-white outline-none text-sm" placeholder="0" /></div></div>
                  <div><label className="block text-xs text-gold-500 mb-1">下個點交通時間</label><input value={itemForm.travelTime || ''} onChange={e => setItemForm({...itemForm, travelTime: e.target.value})} className="w-full bg-dark-bg border border-gray-600 rounded p-2 text-white outline-none text-sm" placeholder="15 min" /></div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-dark-surface rounded-lg border border-gray-700">
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer"><input type="checkbox" checked={itemForm.isImportant || false} onChange={e => setItemForm({...itemForm, isImportant: e.target.checked})} className="w-4 h-4 rounded accent-gold-500" /><Icons.Star size={16} className={itemForm.isImportant ? "fill-gold-500 text-gold-500" : "text-gray-500"} />標記為重點行程</label>
              </div>
              <div className="p-3 bg-dark-surface rounded-lg border border-gray-700 space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gold-500 font-bold mb-1"><Icons.Paperclip size={16} /> 預訂憑證 (圖片)</label>
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="text-xs text-gray-400 w-full file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-gold-500 file:text-black hover:file:bg-gold-600"/>
                  {itemForm.bookingImage && (<div className="relative w-full h-24 rounded-lg overflow-hidden border border-gray-600"><img src={itemForm.bookingImage} alt="preview" className="w-full h-full object-cover" /><button onClick={() => setItemForm({...itemForm, bookingImage: undefined})} className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1"><Icons.Plus size={14} className="rotate-45" /></button></div>)}
              </div>
              <div className="p-3 bg-dark-surface rounded-lg border border-gray-700">
                   <label className="flex items-center gap-2 text-sm text-gold-500 font-bold mb-2"><Icons.Alert size={16} /> 備案計畫</label>
                  <ul className="space-y-1 mb-2">{itemForm.alternatives?.map((alt, i) => (<li key={i} className="flex justify-between items-center text-xs text-gray-300 bg-dark-bg p-2 rounded">{alt}<button onClick={() => setItemForm({...itemForm, alternatives: itemForm.alternatives?.filter((_, idx) => idx !== i)})} className="text-red-400"><Icons.Plus size={14} className="rotate-45" /></button></li>))}</ul>
                  <div className="flex gap-2"><input value={newAlternative} onChange={e => setNewAlternative(e.target.value)} placeholder="新增備案..." className="flex-1 bg-dark-bg border border-gray-600 rounded px-2 py-1 text-xs text-white" /><button onClick={addAlternative} className="text-gold-500 text-xs font-bold px-2 border border-gold-500 rounded">新增</button></div>
              </div>
              <Button onClick={handleSaveItem} className="w-full mt-4">{modalMode === 'add' ? '確認新增' : '儲存變更'}</Button>
          </div>
      </Modal>

      {imageModalUrl && (
          <div className="fixed inset-0 bg-black/95 z-[70] flex items-center justify-center p-4 animate-fade-in no-print" onClick={() => setImageModalUrl(null)}>
              <div className="relative max-w-full max-h-full"><img src={imageModalUrl} alt="Booking" className="max-w-full max-h-[90vh] rounded-lg shadow-2xl" /><button onClick={() => setImageModalUrl(null)} className="absolute -top-12 right-0 text-white p-2"><Icons.Plus size={32} className="rotate-45" /></button></div>
          </div>
      )}
    </div>
  );
};

// --- Expense Components ---

const EXPENSE_CATEGORIES: { id: ExpenseCategory, label: string, color: string }[] = [
    { id: 'flight', label: '機票', color: '#3b82f6' },
    { id: 'accommodation', label: '住宿', color: '#ec4899' },
    { id: 'internet', label: '網路', color: '#14b8a6' },
    { id: 'transport', label: '交通', color: '#8b5cf6' },
    { id: 'ticket', label: '門票', color: '#ef4444' },
    { id: 'food', label: '飲食', color: '#f97316' },
    { id: 'souvenir', label: '紀念品', color: '#eab308' },
    { id: 'other', label: '其他', color: '#6b7280' },
];

// Lightweight SVG Pie Chart Component
const PieChart = ({ data }: { data: { label: string, value: number, color: string }[] }) => {
    const total = data.reduce((acc, cur) => acc + cur.value, 0);
    if (total === 0) return <div className="w-full h-48 flex items-center justify-center text-gray-500">尚無支出資料</div>;

    let startAngle = 0;
    const radius = 50;
    const cx = 50;
    const cy = 50;

    return (
        <div className="flex items-center gap-6">
            <div className="w-40 h-40 relative flex-shrink-0">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    {data.map((slice, index) => {
                        if (slice.value === 0) return null;
                        const angle = (slice.value / total) * 360;
                        const largeArcFlag = angle > 180 ? 1 : 0;
                        const x1 = cx + radius * Math.cos((Math.PI * startAngle) / 180);
                        const y1 = cy + radius * Math.sin((Math.PI * startAngle) / 180);
                        const endAngle = startAngle + angle;
                        const x2 = cx + radius * Math.cos((Math.PI * endAngle) / 180);
                        const y2 = cy + radius * Math.sin((Math.PI * endAngle) / 180);
                        
                        const pathData = total === slice.value 
                            ? `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy + radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy - radius}` // Full circle
                            : `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;

                        startAngle += angle;
                        return (
                            <path key={index} d={pathData} fill={slice.color} stroke="#1A1A1A" strokeWidth="2" />
                        );
                    })}
                </svg>
            </div>
            <div className="flex-1 space-y-2">
                {data.sort((a,b) => b.value - a.value).map((item, idx) => (
                    item.value > 0 && (
                        <div key={idx} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                                <span className="text-gray-300">{item.label}</span>
                            </div>
                            <span className="font-mono text-white">{Math.round((item.value / total) * 100)}%</span>
                        </div>
                    )
                ))}
            </div>
        </div>
    );
};

const ExpenseView = ({ trip, updateTrip, isPrinting = false }: { trip: Trip; updateTrip: (t: Trip) => void, isPrinting?: boolean }) => {
    const [subTab, setSubTab] = useState<'budget' | 'list' | 'analysis'>('list');
    
    // Calculator State
    const [calcAmount, setCalcAmount] = useState('');
    const [calcRate, setCalcRate] = useState(trip.exchangeRate || 1);
    const [calcIsForeign, setCalcIsForeign] = useState(true);
    const [calcPayment, setCalcPayment] = useState<PaymentMethod>('cash');
    
    // Modal & Form State
    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
    const [expenseForm, setExpenseForm] = useState<Partial<Expense>>({
        item: '', foreignAmount: 0, category: 'food', split: 'me', paymentMethod: 'cash', currency: trip.currencyCode
    });
    const [photoModal, setPhotoModal] = useState<string | null>(null);

    // History for Undo
    const [history, setHistory] = useState<Expense[][]>([trip.expenses]);
    const [historyPtr, setHistoryPtr] = useState(0);

    const today = new Date().toISOString().split('T')[0];
    const isTodayInTrip = today >= trip.startDate && today <= trip.endDate;

    const pushHistory = (newExpenses: Expense[]) => {
        const newHistory = history.slice(0, historyPtr + 1);
        newHistory.push(newExpenses);
        setHistory(newHistory);
        setHistoryPtr(newHistory.length - 1);
        updateTrip({ ...trip, expenses: newExpenses });
    };

    const undo = () => {
        if (historyPtr > 0) {
            const prev = history[historyPtr - 1];
            setHistoryPtr(historyPtr - 1);
            updateTrip({ ...trip, expenses: prev });
        }
    };

    const redo = () => {
        if (historyPtr < history.length - 1) {
            const next = history[historyPtr + 1];
            setHistoryPtr(historyPtr + 1);
            updateTrip({ ...trip, expenses: next });
        }
    };

    // Actions
    const openAddExpense = () => {
        setModalMode('add');
        setExpenseForm({ item: '', foreignAmount: undefined, twdAmount: undefined, category: 'food', split: 'me', paymentMethod: 'cash', currency: trip.currencyCode, exchangeRate: trip.exchangeRate });
        setIsExpenseModalOpen(true);
    };

    const openEditExpense = (e: Expense) => {
        setModalMode('edit');
        setExpenseForm({ ...e });
        setIsExpenseModalOpen(true);
    };

    const handleSaveExpense = () => {
        if (!expenseForm.item || (expenseForm.foreignAmount === undefined && expenseForm.twdAmount === undefined)) return alert("請輸入項目與金額");
        
        const fAmount = Number(expenseForm.foreignAmount) || 0;
        const rate = expenseForm.exchangeRate || 1;
        // Auto Calc TWD if not manually overridden or if adding new
        let finalTwd = expenseForm.twdAmount;
        
        if (!finalTwd || (modalMode === 'add' && fAmount > 0)) {
             finalTwd = Math.round(fAmount * rate * (expenseForm.paymentMethod !== 'cash' ? 1.015 : 1));
        }

        const newExpense: Expense = {
            id: expenseForm.id || generateId(),
            item: expenseForm.item!,
            foreignAmount: fAmount,
            twdAmount: Number(finalTwd),
            exchangeRate: rate,
            currency: expenseForm.currency || 'TWD',
            category: expenseForm.category || 'food',
            paymentMethod: expenseForm.paymentMethod || 'cash',
            split: expenseForm.split || 'me',
            photo: expenseForm.photo,
            itemId: expenseForm.itemId,
            date: expenseForm.date || new Date().toISOString()
        };

        const newExpensesList = [...trip.expenses];
        if (modalMode === 'add') {
            newExpensesList.push(newExpense);
        } else {
            const idx = newExpensesList.findIndex(x => x.id === newExpense.id);
            if (idx !== -1) newExpensesList[idx] = newExpense;
        }

        pushHistory(newExpensesList);
        setIsExpenseModalOpen(false);
    };

    const deleteExpense = (id: string) => {
        if(!confirm("確定刪除此筆支出?")) return;
        pushHistory(trip.expenses.filter(e => e.id !== id));
    };

    const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) compressImage(e.target.files[0]).then(base64 => setExpenseForm({...expenseForm, photo: base64}));
    };

    const updateBudget = (cat: ExpenseCategory, amount: number) => {
        const newBudgets = [...(trip.budgets || [])];
        const idx = newBudgets.findIndex(b => b.category === cat);
        if (idx >= 0) newBudgets[idx].amount = amount;
        else newBudgets.push({ id: generateId(), category: cat, amount });
        updateTrip({ ...trip, budgets: newBudgets });
    };

    // Calculation Data
    const totalSpent = (trip.expenses || []).reduce((sum, e) => sum + e.twdAmount, 0);
    const totalBudget = trip.budget;
    const remainingBudget = totalBudget - totalSpent;
    
    // Split Stats
    const splitStats = useMemo(() => {
        const stats = { me: 0, parents: 0, shared: 0 };
        (trip.expenses || []).forEach(e => {
            if (stats[e.split] !== undefined) stats[e.split] += e.twdAmount;
        });
        return stats;
    }, [trip.expenses]);

    // Pie Chart Data
    const pieData = EXPENSE_CATEGORIES.map(cat => ({
        label: cat.label,
        value: (trip.expenses || []).filter(e => e.category === cat.id).reduce((sum, e) => sum + e.twdAmount, 0),
        color: cat.color
    }));

    const renderCalculator = () => {
        const amount = parseFloat(calcAmount) || 0;
        const total = calcPayment !== 'cash' ? (amount * calcRate * 1.015) : (amount * calcRate);
        return (
            <Card className="mb-6 bg-gradient-to-br from-gray-900 to-black border-gold-500/50">
                <div className="flex justify-between items-center mb-4"><h3 className="text-gold-500 font-bold flex items-center gap-2"><Icons.Wallet size={20}/> 即時換算</h3><div className="text-xs text-gray-500">Rate: {calcRate}</div></div>
                <div className="flex gap-2 mb-3">
                    <div className="flex-1"><label className="text-xs text-gray-400 block mb-1">金額 ({calcIsForeign ? trip.currencyCode : 'TWD'})</label><input type="number" value={calcAmount} onChange={e => {setCalcAmount(e.target.value);}} className="w-full bg-dark-surface border border-gray-700 rounded p-2 text-xl font-mono text-white outline-none" placeholder="0"/></div>
                    <div className="w-24"><label className="text-xs text-gray-400 block mb-1">匯率</label><input type="number" value={calcRate} onChange={e => setCalcRate(parseFloat(e.target.value))} className="w-full bg-dark-surface border border-gray-700 rounded p-2 text-white outline-none" /></div>
                </div>
                <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar">
                     <button onClick={() => setCalcPayment('cash')} className={`px-3 py-1 rounded-full text-xs border ${calcPayment === 'cash' ? 'bg-green-500/20 text-green-400 border-green-500' : 'border-gray-700 text-gray-400'}`}>現金</button>
                     <button onClick={() => setCalcPayment('cube_card')} className={`px-3 py-1 rounded-full text-xs border ${calcPayment === 'cube_card' ? 'bg-pink-500/20 text-pink-400 border-pink-500' : 'border-gray-700 text-gray-400'}`}>Cube卡 (+1.5%)</button>
                     <button onClick={() => setCalcPayment('credit_card')} className={`px-3 py-1 rounded-full text-xs border ${calcPayment === 'credit_card' ? 'bg-blue-500/20 text-blue-400 border-blue-500' : 'border-gray-700 text-gray-400'}`}>信用卡 (+1.5%)</button>
                </div>
                <div className="bg-dark-bg p-3 rounded-lg flex justify-between items-center border border-gray-800"><span className="text-gray-400 text-sm">試算結果 (TWD)</span><span className="text-2xl font-bold text-gold-400">{Math.round(total).toLocaleString()}</span></div>
            </Card>
        );
    };

    return (
        <div className="pb-24">
            <div className="flex justify-center gap-4 mb-6 sticky top-16 bg-dark-bg/95 py-2 z-40 no-print">
                {['list', 'analysis', 'budget'].map((t) => (
                    <button key={t} onClick={() => setSubTab(t as any)} className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${subTab === t ? 'bg-gold-500 text-black shadow-lg shadow-gold-500/20' : 'text-gray-500 bg-dark-surface'}`}>{t === 'budget' ? '預算' : t === 'list' ? '記帳' : '分析'}</button>
                ))}
            </div>
            
            {isTodayInTrip && subTab === 'list' && <div className="mb-6 bg-gradient-to-r from-gold-500/10 to-transparent p-3 rounded-xl border-l-4 border-gold-500 flex items-center justify-between no-print"><div className="text-sm text-gold-400 font-bold">🔔 別忘了記錄今天的消費！</div></div>}
            
            {(subTab === 'budget' || isPrinting) && (
                <div className="space-y-4 animate-fade-in break-inside-avoid">
                    <Card>
                        <div className="flex justify-between items-end mb-4"><h3 className="text-xl font-bold text-white">總預算</h3><span className="text-2xl font-serif text-gold-500">{trip.budget.toLocaleString()} TWD</span></div>
                        <div className="space-y-4">{EXPENSE_CATEGORIES.map(cat => (<div key={cat.id} className="flex items-center gap-3"><span className="w-16 text-sm text-gray-300">{cat.label}</span><div className="flex-1 bg-dark-bg border border-gray-700 rounded-lg flex items-center px-3"><span className="text-gray-500 text-xs">$</span><input type="number" value={trip.budgets?.find(b => b.category === cat.id)?.amount || ''} onChange={e => updateBudget(cat.id, parseFloat(e.target.value))} placeholder="未設定" className="bg-transparent w-full p-2 text-white outline-none text-right"/></div></div>))}</div>
                    </Card>

                    {/* Budget Bars - Moved here from Analysis */}
                    <Card className="break-inside-avoid">
                        <h3 className="text-lg font-bold text-white mb-4">預算執行率</h3>
                        <div className="space-y-4">
                            {EXPENSE_CATEGORIES.map(cat => {
                                const spent = (trip.expenses || []).filter(e => e.category === cat.id).reduce((sum, e) => sum + e.twdAmount, 0);
                                const budget = trip.budgets?.find(b => b.category === cat.id)?.amount || 0;
                                const percent = budget > 0 ? Math.min((spent / budget) * 100, 100) : (spent > 0 ? 100 : 0);
                                
                                return (
                                    <div key={cat.id}>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-gray-300">{cat.label}</span>
                                            <span>
                                                <span className={spent > budget && budget > 0 ? 'text-red-400' : 'text-white'}>{spent.toLocaleString()}</span>
                                                <span className="text-gray-600"> / {budget > 0 ? budget.toLocaleString() : '-'}</span>
                                            </span>
                                        </div>
                                        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                            <div className={`h-full rounded-full ${spent > budget && budget > 0 ? 'bg-red-500' : ''}`} style={{ width: `${percent}%`, backgroundColor: spent <= budget ? cat.color : undefined }}></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                </div>
            )}
            
            {(subTab === 'list' || isPrinting) && (
                <div className="animate-fade-in mt-6">
                    <div className="no-print">{renderCalculator()}</div>
                    
                    <div className="flex justify-between items-center mb-4 no-print">
                        <Button onClick={openAddExpense} className="flex-1 shadow-gold-500/20"><Icons.Plus size={18} className="mr-2"/> 新增支出</Button>
                        <div className="flex gap-2 ml-4">
                            <button onClick={undo} disabled={historyPtr === 0} className="p-3 bg-dark-surface rounded-full text-gray-400 disabled:opacity-30 border border-gray-700"><Icons.ChevronLeft size={20}/></button>
                            <button onClick={redo} disabled={historyPtr === history.length - 1} className="p-3 bg-dark-surface rounded-full text-gray-400 disabled:opacity-30 border border-gray-700"><Icons.ChevronLeft className="rotate-180" size={20}/></button>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <h4 className="text-lg font-bold mb-2 text-white print:text-black">支出明細</h4>
                        {(trip.expenses || []).length === 0 ? <div className="text-center text-gray-500 py-10">尚無支出紀錄</div> : 
                         (trip.expenses || []).slice().reverse().map(e => (
                            <div key={e.id} className="bg-dark-surface p-4 rounded-xl border border-gray-800 flex gap-4 items-center break-inside-avoid group relative">
                                <div onClick={() => e.photo && setPhotoModal(e.photo)} className={`w-12 h-12 rounded-lg flex-shrink-0 flex items-center justify-center bg-gray-900 overflow-hidden cursor-pointer ${e.photo ? 'border border-gold-500/50' : ''}`}>{e.photo ? <img src={e.photo} className="w-full h-full object-cover" /> : <Icons.Wallet className="text-gray-700" />}</div>
                                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => !isPrinting && openEditExpense(e)}>
                                    <div className="flex justify-between items-start">
                                        <h4 className="font-bold text-white truncate">{e.item}</h4>
                                        <span className="font-mono font-bold text-gold-400">{e.twdAmount.toLocaleString()} <span className="text-xs text-gold-600">TWD</span></span>
                                    </div>
                                    <div className="flex justify-between items-end mt-1">
                                        <div className="text-xs text-gray-500 flex flex-col">
                                            <span>{e.currency} {e.foreignAmount}</span>
                                            <span className="flex items-center gap-1 mt-1">
                                                <span className="bg-gray-700 text-gray-300 px-1 rounded">{EXPENSE_CATEGORIES.find(c => c.id === e.category)?.label}</span>
                                                <span className="bg-gray-800 text-gray-400 px-1 rounded border border-gray-700">{e.split === 'me' ? '個人' : e.split === 'parents' ? '父母' : '分帳'}</span>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute right-2 top-2 no-print bg-dark-bg/80 p-1 rounded-lg">
                                    <button onClick={() => openEditExpense(e)} className="text-gray-400 hover:text-white p-1"><Icons.Edit size={16}/></button>
                                    <button onClick={() => deleteExpense(e.id)} className="text-gray-400 hover:text-red-400 p-1"><Icons.Trash size={16} /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            
            {(subTab === 'analysis' || isPrinting) && (
                <div className="animate-fade-in space-y-6 mt-6">
                    {/* Total Summary */}
                    <div className="grid grid-cols-2 gap-4 break-inside-avoid">
                        <Card className="bg-gradient-to-br from-gray-800 to-gray-900 border-gold-500/30">
                            <div className="text-xs text-gray-400 mb-1">總支出 (TWD)</div>
                            <div className="text-2xl font-mono font-bold text-gold-400">{totalSpent.toLocaleString()}</div>
                        </Card>
                        <Card className="bg-gradient-to-br from-gray-800 to-gray-900 border-gray-700">
                            <div className="text-xs text-gray-400 mb-1">剩餘預算</div>
                            <div className={`text-2xl font-mono font-bold ${remainingBudget < 0 ? 'text-red-400' : 'text-green-400'}`}>{remainingBudget.toLocaleString()}</div>
                        </Card>
                    </div>

                    {/* Chart Analysis */}
                    <Card className="break-inside-avoid">
                        <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2"><Icons.TrendingUp size={20} className="text-gold-500"/> 類別佔比</h3>
                        <PieChart data={pieData} />
                    </Card>

                    {/* Split Analysis */}
                    <Card className="break-inside-avoid">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Icons.Wallet size={20} className="text-blue-400"/> 分帳統計</h3>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="p-2 bg-dark-bg rounded-lg border border-gray-700">
                                <div className="text-xs text-gray-500 mb-1">個人 (Me)</div>
                                <div className="text-sm font-bold text-white">${splitStats.me.toLocaleString()}</div>
                            </div>
                            <div className="p-2 bg-dark-bg rounded-lg border border-gray-700">
                                <div className="text-xs text-gray-500 mb-1">父母 (Parents)</div>
                                <div className="text-sm font-bold text-white">${splitStats.parents.toLocaleString()}</div>
                            </div>
                            <div className="p-2 bg-dark-bg rounded-lg border border-gray-700">
                                <div className="text-xs text-gray-500 mb-1">公費 (Shared)</div>
                                <div className="text-sm font-bold text-white">${splitStats.shared.toLocaleString()}</div>
                            </div>
                        </div>
                    </Card>
                </div>
            )}

            {photoModal && <div className="fixed inset-0 bg-black/95 z-[70] flex items-center justify-center p-4 no-print" onClick={() => setPhotoModal(null)}><img src={photoModal} className="max-w-full max-h-[90vh] rounded shadow-2xl" /></div>}

            {/* Expense Add/Edit Modal */}
            <Modal isOpen={isExpenseModalOpen} onClose={() => setIsExpenseModalOpen(false)} title={modalMode === 'add' ? '新增支出' : '編輯支出'}>
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs text-gold-500 mb-1">品項名稱</label>
                        <input value={expenseForm.item || ''} onChange={e => setExpenseForm({...expenseForm, item: e.target.value})} placeholder="例如：晚餐" className="w-full bg-dark-bg border border-gray-700 rounded-lg p-3 text-white outline-none focus:border-gold-500" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs text-gold-500 mb-1">外幣金額 ({trip.currencyCode})</label>
                            <input type="number" value={expenseForm.foreignAmount || ''} onChange={e => setExpenseForm({...expenseForm, foreignAmount: parseFloat(e.target.value)})} placeholder="0" className="w-full bg-dark-bg border border-gray-700 rounded-lg p-3 text-white outline-none focus:border-gold-500" />
                        </div>
                        <div>
                            <label className="block text-xs text-gold-500 mb-1">匯率</label>
                            <input type="number" value={expenseForm.exchangeRate || trip.exchangeRate} onChange={e => setExpenseForm({...expenseForm, exchangeRate: parseFloat(e.target.value)})} className="w-full bg-dark-bg border border-gray-700 rounded-lg p-3 text-white outline-none focus:border-gold-500" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs text-gold-500 mb-1">台幣金額 (自動計算/手動修改)</label>
                        <input type="number" value={expenseForm.twdAmount || ''} onChange={e => setExpenseForm({...expenseForm, twdAmount: parseFloat(e.target.value)})} placeholder="0" className="w-full bg-dark-bg border border-gray-700 rounded-lg p-3 text-white outline-none focus:border-gold-500 font-mono text-gold-400 font-bold" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">分類</label>
                            <select value={expenseForm.category || 'food'} onChange={e => setExpenseForm({...expenseForm, category: e.target.value as ExpenseCategory})} className="w-full bg-dark-bg border border-gray-700 rounded-lg p-3 text-white outline-none">
                                {EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">分帳</label>
                            <select value={expenseForm.split || 'me'} onChange={e => setExpenseForm({...expenseForm, split: e.target.value as SplitType})} className="w-full bg-dark-bg border border-gray-700 rounded-lg p-3 text-white outline-none">
                                <option value="me">個人</option>
                                <option value="parents">父母</option>
                                <option value="shared">公費</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">支付方式</label>
                        <div className="flex gap-2">
                            {(['cash', 'cube_card', 'credit_card'] as PaymentMethod[]).map(pm => (
                                <button key={pm} onClick={() => setExpenseForm({...expenseForm, paymentMethod: pm})} className={`flex-1 py-2 rounded-lg text-xs border ${expenseForm.paymentMethod === pm ? 'bg-gold-500 text-black border-gold-500' : 'bg-dark-surface text-gray-400 border-gray-700'}`}>
                                    {pm === 'cash' ? '現金' : pm === 'cube_card' ? 'Cube卡' : '信用卡'}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="flex-1 bg-dark-bg border border-gray-700 rounded-lg p-3 flex items-center justify-center gap-2 cursor-pointer hover:bg-gray-800 transition-colors">
                            <Icons.Camera size={20} className="text-gold-500"/>
                            <span className="text-sm text-gray-400">{expenseForm.photo ? '更改照片' : '上傳收據/照片'}</span>
                            <input type="file" accept="image/*" onChange={handlePhoto} className="hidden" />
                        </label>
                        {expenseForm.photo && (
                            <div className="relative w-12 h-12 rounded overflow-hidden border border-gold-500 flex-shrink-0">
                                <img src={expenseForm.photo} className="w-full h-full object-cover" />
                                <button onClick={() => setExpenseForm({...expenseForm, photo: undefined})} className="absolute top-0 right-0 bg-red-500 text-white p-0.5 rounded-bl"><Icons.Plus className="rotate-45" size={10} /></button>
                            </div>
                        )}
                    </div>
                    <Button onClick={handleSaveExpense} className="w-full mt-4">{modalMode === 'add' ? '加入記帳' : '儲存變更'}</Button>
                </div>
            </Modal>
        </div>
    );
};

// --- Updated Info View ---

const InfoView = ({ trip, updateTrip, isPrinting = false }: { trip: Trip; updateTrip: (t: Trip) => void; isPrinting?: boolean }) => {
    const [activeSubTab, setActiveSubTab] = useState<'tools' | 'bookings' | 'prep'>('tools');
    const [loadingChecklist, setLoadingChecklist] = useState(false);
    
    // Checklist State
    const [newCheckItem, setNewCheckItem] = useState('');
    const [newCheckCat, setNewCheckCat] = useState('其他');
    
    // Voucher State
    const [voucherTitle, setVoucherTitle] = useState('');
    const [voucherFile, setVoucherFile] = useState<{data: string, type: 'image' | 'pdf'} | null>(null);

    // Booking Modal State
    const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
    const [bookingMode, setBookingMode] = useState<'add' | 'edit'>('add');
    const [bookingType, setBookingType] = useState<'flight' | 'accommodation'>('flight');
    const [bookingForm, setBookingForm] = useState<Partial<ItineraryItem & { date: string }>>({});
    const [bookingDetails, setBookingDetails] = useState<BookingDetails>({});

    // Split Calculation for Accommodation
    const [splitGuests, setSplitGuests] = useState<{ [key: string]: number }>({});

    // --- Actions ---

    const toggleCheck = (id: string) => {
        const newTrip = { ...trip };
        const item = (newTrip.checklist || []).find(i => i.id === id);
        if (item) item.checked = !item.checked;
        updateTrip(newTrip);
    };

    const addCheckItem = () => {
        if (!newCheckItem) return;
        const newItem: ChecklistItem = { id: generateId(), text: newCheckItem, checked: false, category: newCheckCat };
        updateTrip({ ...trip, checklist: [...(trip.checklist || []), newItem] });
        setNewCheckItem('');
    };

    const deleteCheckItem = (id: string) => {
        updateTrip({ ...trip, checklist: (trip.checklist || []).filter(c => c.id !== id) });
    };

    // Removed handleGenerateChecklist as per request

    const handleVoucherUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            handleFileUpload(e.target.files[0]).then(res => {
                const newVoucher: Voucher = { 
                    id: generateId(), 
                    title: voucherTitle || res.name, 
                    image: res.data, 
                    fileType: res.type,
                    date: new Date().toISOString() 
                };
                updateTrip({ ...trip, vouchers: [...(trip.vouchers || []), newVoucher] });
                setVoucherTitle('');
            });
        }
    };

    const deleteVoucher = (id: string) => {
        if (!confirm("確定刪除此憑證？")) return;
        updateTrip({...trip, vouchers: (trip.vouchers || []).filter(v => v.id !== id)});
    }

    const handleMemoChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        updateTrip({ ...trip, memo: e.target.value });
    };

    // --- Booking Logic ---

    const openAddBooking = (type: 'flight' | 'accommodation') => {
        setBookingMode('add');
        setBookingType(type);
        setBookingForm({ date: trip.startDate, activity: '', location: '', cost: 0 });
        setBookingDetails({});
        setIsBookingModalOpen(true);
    };

    const openEditBooking = (item: ItineraryItem, date: string) => {
        setBookingMode('edit');
        setBookingType(item.type === 'flight' ? 'flight' : 'accommodation');
        setBookingForm({ ...item, date });
        setBookingDetails(item.bookingDetails || {});
        setIsBookingModalOpen(true);
    };

    const handleSaveBooking = () => {
        if (!bookingForm.activity || !bookingForm.date) return alert("請填寫必要資訊");

        const newTrip = { ...trip };
        
        // Remove old item if editing (find by ID across all days)
        if (bookingMode === 'edit') {
            (newTrip.itinerary || []).forEach(day => {
                day.items = (day.items || []).filter(i => i.id !== bookingForm.id);
            });
        }

        // Create new item
        const newItem: ItineraryItem = {
            id: bookingForm.id || generateId(),
            time: bookingForm.time || '00:00',
            endTime: bookingForm.endTime, // Save endTime for flight arrival
            activity: bookingForm.activity!,
            location: bookingForm.location || '',
            type: bookingType,
            cost: Number(bookingForm.cost) || 0,
            bookingDetails: bookingDetails,
            bookingImage: bookingForm.bookingImage,
            // Defaults
            isImportant: bookingForm.isImportant || false,
            alternatives: [],
            isCompleted: false
        };

        // Find correct day to insert
        const targetDate = bookingForm.date;
        const dayPlan = (newTrip.itinerary || []).find(d => d.date === targetDate);
        
        if (dayPlan) {
            dayPlan.items = dayPlan.items || [];
            dayPlan.items.push(newItem);
            dayPlan.items.sort((a, b) => a.time.localeCompare(b.time));
        } else {
            alert("日期超出旅程範圍，將加入第一天");
            if (newTrip.itinerary?.[0]) {
                newTrip.itinerary[0].items.push(newItem);
            }
        }

        updateTrip(newTrip);
        setIsBookingModalOpen(false);
    };

    const deleteBooking = (id: string) => {
        if (!confirm("確定刪除此預訂？")) return;
        const newTrip = { ...trip };
        (newTrip.itinerary || []).forEach(day => {
            day.items = (day.items || []).filter(i => i.id !== id);
        });
        updateTrip(newTrip);
    };

    const handleBookingFile = (e: React.ChangeEvent<HTMLInputElement>) => {
         if (e.target.files?.[0]) {
            handleFileUpload(e.target.files[0]).then(res => {
                 setBookingForm(prev => ({ ...prev, bookingImage: res.data }));
            });
        }
    };

    // Memo URL detection
    const memoLinks = useMemo(() => {
        if (!trip.memo) return [];
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        return trip.memo.match(urlRegex) || [];
    }, [trip.memo]);

    // Data Aggregation for Bookings
    const flights = (trip.itinerary || []).flatMap(day => (day.items || []).filter(i => i.type === 'flight').map(i => ({...i, date: day.date})));
    const hotels = (trip.itinerary || []).flatMap(day => (day.items || []).filter(i => i.type === 'accommodation').map(i => ({...i, date: day.date})));

    // Voucher handling
    const [voucherMode, setVoucherMode] = useState<'add' | 'edit'>('add');
    const [voucherForm, setVoucherForm] = useState<Partial<Voucher>>({});
    const [viewingVoucher, setViewingVoucher] = useState<Voucher | null>(null);
    const [isVoucherModalOpen, setIsVoucherModalOpen] = useState(false);

    const openAddVoucher = () => {
        setVoucherMode('add');
        setVoucherForm({ title: '' });
        setIsVoucherModalOpen(true);
    };

    const openEditVoucher = (v: Voucher) => {
        setVoucherMode('edit');
        setVoucherForm({ ...v });
        setIsVoucherModalOpen(true);
    };

    const handleVoucherFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            handleFileUpload(e.target.files[0]).then(res => {
                setVoucherForm(prev => ({
                    ...prev,
                    image: res.data,
                    fileType: res.type,
                    fileName: res.name
                }));
            });
        }
    };

    const handleSaveVoucher = () => {
        if (!voucherForm.title || !voucherForm.image) return alert("請輸入名稱並上傳檔案");
        
        const newVoucher: Voucher = {
            id: voucherForm.id || generateId(),
            title: voucherForm.title,
            image: voucherForm.image,
            fileType: voucherForm.fileType || 'image',
            fileName: voucherForm.fileName,
            date: new Date().toISOString()
        };

        const newVouchers = [...(trip.vouchers || [])];
        if (voucherMode === 'add') {
            newVouchers.push(newVoucher);
        } else {
            const idx = newVouchers.findIndex(v => v.id === newVoucher.id);
            if (idx !== -1) newVouchers[idx] = newVoucher;
        }
        
        updateTrip({ ...trip, vouchers: newVouchers });
        setIsVoucherModalOpen(false);
    };

    return (
        <div className="pb-24 animate-fade-in">
             {/* Sub Tabs */}
            <div className="flex justify-center gap-2 mb-6 sticky top-16 bg-dark-bg/95 py-2 z-40 no-print overflow-x-auto no-scrollbar">
                {[
                    { id: 'tools', label: '工具與緊急', icon: Icons.Alert },
                    { id: 'bookings', label: '預訂 & 憑證', icon: Icons.Plane },
                    { id: 'prep', label: '行前準備', icon: Icons.CheckCircle }
                ].map((t) => (
                    <button 
                        key={t.id}
                        onClick={() => setActiveSubTab(t.id as any)}
                        className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${activeSubTab === t.id ? 'bg-gold-500 text-black shadow-lg shadow-gold-500/20' : 'text-gray-500 bg-dark-surface'}`}
                    >
                        <t.icon size={14} /> {t.label}
                    </button>
                ))}
            </div>

            {/* TOOLS TAB */}
            {(activeSubTab === 'tools' || isPrinting) && (
                <div className="space-y-6">
                    {/* Translate Tools - HIDE IN PRINT */}
                    <div className="grid grid-cols-2 gap-4 no-print">
                        <a href="https://translate.google.com/?op=images" target="_blank" className="bg-gradient-to-br from-blue-600 to-blue-800 p-4 rounded-2xl shadow-lg flex flex-col items-center justify-center gap-2 hover:scale-105 transition-transform">
                            <Icons.Camera size={32} className="text-white" />
                            <span className="text-white font-bold">拍照翻譯</span>
                        </a>
                        <a href="https://translate.google.com/?op=translate" target="_blank" className="bg-gradient-to-br from-indigo-600 to-indigo-800 p-4 rounded-2xl shadow-lg flex flex-col items-center justify-center gap-2 hover:scale-105 transition-transform">
                            <div className="bg-white/20 p-2 rounded-full"><Icons.Sparkles size={20} className="text-white" /></div>
                            <span className="text-white font-bold">語音對話</span>
                        </a>
                    </div>

                    {/* Emergency Contacts */}
                    <Card className="border-red-500/30">
                        <h3 className="text-red-400 font-bold mb-4 flex items-center gap-2"><Icons.Alert size={20}/> 緊急聯絡資訊</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-red-900/10 p-3 rounded-lg border border-red-900/30 text-center">
                                <div className="text-xs text-red-300 mb-1">警察 (Police)</div>
                                <div className="text-xl font-mono font-bold text-red-500">{trip.emergency?.police || '110'}</div>
                            </div>
                            <div className="bg-red-900/10 p-3 rounded-lg border border-red-900/30 text-center">
                                <div className="text-xs text-red-300 mb-1">救護車 (Ambulance)</div>
                                <div className="text-xl font-mono font-bold text-red-500">{trip.emergency?.ambulance || '119'}</div>
                            </div>
                        </div>
                        <div className="mt-4 space-y-2">
                             <div className="flex justify-between items-center p-3 bg-dark-bg rounded-lg">
                                 <span className="text-gray-400 text-sm">外交部辦事處</span>
                                 <span className="text-white text-sm font-bold">{trip.emergency?.embassy || '未設定'}</span>
                             </div>
                             <div className="flex justify-between items-center p-3 bg-dark-bg rounded-lg">
                                 <span className="text-gray-400 text-sm">最近醫院</span>
                                 <a href={`https://www.google.com/maps/search/?api=1&query=hospital`} target="_blank" className="text-gold-500 text-sm font-bold flex items-center gap-1 no-print">
                                     {trip.emergency?.hospital || '搜尋醫院'} <Icons.Navigation size={12} />
                                 </a>
                                 <span className="print-only text-black font-bold">{trip.emergency?.hospital}</span>
                             </div>
                        </div>
                    </Card>

                    {/* Tips & Taboos */}
                    <div className="space-y-4 break-inside-avoid">
                        <h3 className="text-gold-500 font-bold px-2">旅遊須知 & 禁忌</h3>
                        {(trip.tips || []).length > 0 ? (trip.tips || []).map((tip, idx) => (
                            <div key={idx} className="bg-dark-surface p-4 rounded-xl border border-gray-800 flex gap-3">
                                <div className={`w-1 shrink-0 rounded-full ${tip.category === 'taboo' ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                                <div>
                                    <div className="text-xs text-gray-500 uppercase font-bold mb-1">{tip.category}</div>
                                    <p className="text-sm text-gray-200">{tip.content}</p>
                                </div>
                            </div>
                        )) : (
                            <div className="text-center text-gray-500 py-4">尚無資訊</div>
                        )}
                    </div>
                </div>
            )}

            {/* BOOKINGS TAB */}
            {(activeSubTab === 'bookings' || isPrinting) && (
                <div className="space-y-8 mt-6">
                    {/* Flights */}
                    <div>
                        <div className="flex justify-between items-center mb-3 px-2">
                            <h3 className="text-gray-400 text-sm font-bold uppercase tracking-wider">機票 (Flight)</h3>
                            <button onClick={() => openAddBooking('flight')} className="text-gold-500 text-xs border border-gold-500/30 px-2 py-1 rounded bg-gold-500/10 no-print">+ 新增航班</button>
                        </div>
                        <div className="space-y-4">
                            {flights.length === 0 ? <div className="text-center text-gray-600 py-4 border border-dashed border-gray-800 rounded-xl">無航班資訊</div> : 
                             flights.map(f => (
                                 <div key={f.id} className="bg-dark-card rounded-2xl overflow-hidden shadow-2xl border border-gray-700 relative group break-inside-avoid">
                                     {/* Boarding Pass Header */}
                                     <div className="bg-gradient-to-r from-blue-900 to-slate-900 p-4 flex justify-between items-center border-b border-white/10">
                                         <div className="text-xs font-bold text-blue-300 uppercase tracking-widest">{f.bookingDetails?.airline || '登機證'}</div>
                                         <Icons.Plane className="text-white/50" />
                                     </div>
                                     <div className="p-5 relative">
                                         <div className="flex justify-between items-center mb-6">
                                             <div className="text-left">
                                                 <div className="text-3xl font-mono font-bold text-white tracking-tighter uppercase">{f.location.substring(0,3) || '出發'}</div>
                                                 <div className="text-[10px] text-gray-500 mt-1 max-w-[80px] truncate">{f.location || '出發地'}</div>
                                             </div>
                                             <div className="flex-1 flex flex-col items-center px-2">
                                                 <div className="text-xs text-gold-500 font-bold mb-1">{calculateDuration(f.time, f.endTime)}</div>
                                                 <div className="w-full h-px bg-gray-600 relative">
                                                      <Icons.Plane className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-gold-500 rotate-90 bg-dark-card p-0.5 w-6 h-6" size={16} />
                                                 </div>
                                             </div>
                                             <div className="text-right">
                                                 <div className="text-3xl font-mono font-bold text-white tracking-tighter uppercase">{f.activity.includes('To') ? f.activity.split('To')[1].trim().substring(0,3) : '抵達'}</div>
                                                 <div className="text-[10px] text-gray-500 mt-1 max-w-[80px] truncate">{f.activity || '目的地'}</div>
                                             </div>
                                         </div>
                                         
                                         <div className="grid grid-cols-4 gap-y-4 gap-x-2 border-t border-gray-800 pt-4">
                                             <div><div className="text-[9px] text-gray-500 uppercase">日期</div><div className="font-bold text-sm text-white">{f.date}</div></div>
                                             <div><div className="text-[9px] text-gray-500 uppercase">起飛</div><div className="font-bold text-sm text-white">{f.time}</div></div>
                                             <div><div className="text-[9px] text-gray-500 uppercase">抵達</div><div className="font-bold text-sm text-white">{f.endTime || '-'}</div></div>
                                             <div><div className="text-[9px] text-gray-500 uppercase">航班</div><div className="font-bold text-sm text-gold-500">{f.bookingDetails?.flightNumber || 'N/A'}</div></div>
                                             
                                             <div><div className="text-[9px] text-gray-500 uppercase">航廈</div><div className="font-bold text-sm text-white">{f.bookingDetails?.terminal || '-'}</div></div>
                                             <div><div className="text-[9px] text-gray-500 uppercase">登機門</div><div className="font-bold text-sm text-white">{f.bookingDetails?.gate || '-'}</div></div>
                                             <div className="col-span-2"><div className="text-[9px] text-gray-500 uppercase">座位</div><div className="font-bold text-sm text-white">{f.bookingDetails?.seat || '-'}</div></div>
                                         </div>
                                     </div>
                                     {/* Action Bar */}
                                     <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity no-print">
                                         <button onClick={() => openEditBooking(f, f.date)} className="bg-black/50 text-white p-1.5 rounded-full hover:bg-gold-500 hover:text-black"><Icons.Edit size={14}/></button>
                                         <button onClick={() => deleteBooking(f.id)} className="bg-black/50 text-red-400 p-1.5 rounded-full hover:bg-red-500 hover:text-white"><Icons.Trash size={14}/></button>
                                     </div>
                                     {/* Barcode Strip */}
                                     <div className="bg-white p-2 flex justify-center opacity-80 h-10 overflow-hidden relative">
                                         <div className="absolute inset-0 bg-[url('https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Code_39_barcode.svg/1200px-Code_39_barcode.svg.png')] bg-repeat-x bg-contain opacity-40 mix-blend-multiply"></div>
                                     </div>
                                 </div>
                             ))
                            }
                        </div>
                    </div>

                    {/* Accommodation */}
                    <div className="break-inside-avoid">
                         <div className="flex justify-between items-center mb-3 px-2">
                             <h3 className="text-gray-400 text-sm font-bold uppercase tracking-wider">住宿 (Accommodation)</h3>
                             <button onClick={() => openAddBooking('accommodation')} className="text-gold-500 text-xs border border-gold-500/30 px-2 py-1 rounded bg-gold-500/10 no-print">+ 新增住宿</button>
                         </div>
                         <div className="space-y-4">
                            {hotels.length === 0 ? <div className="text-center text-gray-600 py-4 border border-dashed border-gray-800 rounded-xl">無住宿資訊</div> :
                                hotels.map(h => {
                                    const guests = splitGuests[h.id] || h.bookingDetails?.guests || 2;
                                    const splitCost = h.cost ? Math.round(h.cost / guests) : 0;
                                    
                                    return (
                                        <div key={h.id} className="bg-dark-surface rounded-xl overflow-hidden border border-gray-700 flex flex-col relative group break-inside-avoid">
                                            {h.bookingImage ? (
                                                <div className="h-32 w-full bg-gray-800 relative">
                                                    <img src={h.bookingImage} className="w-full h-full object-cover" />
                                                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                                                        <h4 className="font-bold text-white text-lg">{h.location}</h4>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="p-4 border-b border-gray-800"><h4 className="font-bold text-white text-lg">{h.location}</h4></div>
                                            )}
                                            
                                            <div className="p-4 space-y-3">
                                                <div className="flex gap-4 text-sm bg-black/20 p-2 rounded-lg justify-around">
                                                    <div className="flex flex-col items-center"><span className="text-[10px] text-gray-500 uppercase">入住</span><span className="font-bold text-gold-400">{h.bookingDetails?.checkInTime || '15:00'}</span></div>
                                                    <div className="w-px bg-gray-700"></div>
                                                    <div className="flex flex-col items-center"><span className="text-[10px] text-gray-500 uppercase">退房</span><span className="font-bold text-gray-300">{h.bookingDetails?.checkOutTime || '11:00'}</span></div>
                                                </div>
                                                
                                                <div className="flex items-center gap-2 text-xs text-gray-400">
                                                    <Icons.MapPin size={12}/> {h.activity || '未提供地址'}
                                                </div>

                                                {/* Split Calculator */}
                                                {h.cost && h.cost > 0 && (
                                                    <div className="border-t border-gray-800 pt-3 flex items-center justify-between">
                                                        <div className="text-sm">
                                                            <span className="text-gray-500 block text-xs">總額</span>
                                                            <span className="font-bold text-white">${h.cost.toLocaleString()}</span>
                                                        </div>
                                                        <div className="flex items-center gap-2 bg-dark-bg p-1 rounded-lg border border-gray-700 no-print">
                                                            <button onClick={() => setSplitGuests({...splitGuests, [h.id]: Math.max(1, guests - 1)})} className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white">-</button>
                                                            <div className="flex flex-col items-center w-8">
                                                                <Icons.Wallet size={12} className="text-gold-500 mb-0.5"/>
                                                                <span className="text-xs font-bold leading-none">{guests}</span>
                                                            </div>
                                                            <button onClick={() => setSplitGuests({...splitGuests, [h.id]: guests + 1})} className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-white">+</button>
                                                        </div>
                                                        <div className="text-right">
                                                            <span className="text-gray-500 block text-xs">分攤</span>
                                                            <span className="font-bold text-gold-400">${splitCost.toLocaleString()}</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            
                                            <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 no-print">
                                                <button onClick={() => openEditBooking(h, h.date)} className="bg-black/50 text-white p-1.5 rounded-full hover:bg-gold-500 hover:text-black"><Icons.Edit size={14}/></button>
                                                <button onClick={() => deleteBooking(h.id)} className="bg-black/50 text-red-400 p-1.5 rounded-full hover:bg-red-500 hover:text-white"><Icons.Trash size={14}/></button>
                                            </div>
                                        </div>
                                    );
                                })
                            }
                         </div>
                    </div>

                    {/* Vouchers - Moved from Tickets Tab */}
                    <div className="break-inside-avoid mt-6">
                        <div className="flex justify-between items-center mb-3 px-2">
                            <h3 className="text-gray-400 text-sm font-bold uppercase tracking-wider">票券與憑證 (Tickets)</h3>
                            <button onClick={openAddVoucher} className="text-gold-500 text-xs border border-gold-500/30 px-2 py-1 rounded bg-gold-500/10 no-print">+ 新增憑證</button>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            {(trip.vouchers || []).map(v => (
                                <div key={v.id} onClick={() => setViewingVoucher(v)} className="bg-dark-surface rounded-xl overflow-hidden border border-gray-700 relative group cursor-pointer hover:border-gold-500 transition-colors">
                                    <div className="h-32 bg-gray-800 flex items-center justify-center relative">
                                        {v.fileType === 'pdf' ? (
                                            <Icons.FileText size={40} className="text-red-400" />
                                        ) : (
                                            <img src={v.image} className="w-full h-full object-cover" />
                                        )}
                                        <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors" />
                                    </div>
                                    <div className="p-3">
                                        <div className="font-bold text-white text-sm truncate">{v.title}</div>
                                        <div className="text-[10px] text-gray-500 truncate">{v.fileName || (v.fileType === 'pdf' ? 'PDF 文件' : '圖片檔案')}</div>
                                    </div>
                                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity no-print" onClick={e => e.stopPropagation()}>
                                         <button onClick={() => openEditVoucher(v)} className="bg-black/60 text-white p-1.5 rounded-full hover:bg-gold-500 hover:text-black"><Icons.Edit size={12}/></button>
                                         <button onClick={() => deleteVoucher(v.id)} className="bg-black/60 text-red-400 p-1.5 rounded-full hover:bg-red-500 hover:text-white"><Icons.Trash size={12}/></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {(!trip.vouchers || trip.vouchers.length === 0) && (
                            <div className="text-center text-gray-500 py-8 border-2 border-dashed border-gray-800 rounded-xl">尚無票券</div>
                        )}
                    </div>
                </div>
            )}

            {/* PREPARATION TAB */}
            {(activeSubTab === 'prep' || isPrinting) && (
                <div className="space-y-8 mt-6">
                     {/* Checklist */}
                     <Card>
                         <div className="flex justify-between items-end mb-4">
                             <h3 className="text-lg font-bold text-white">行前準備清單</h3>
                             <span className="text-xs text-gray-500">已內建分類清單</span>
                         </div>

                         <div className="flex gap-2 mb-4 no-print">
                             <input value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)} placeholder="新增項目..." className="flex-1 bg-dark-bg border border-gray-700 rounded px-3 py-2 text-sm text-white" />
                             <select value={newCheckCat} onChange={e => setNewCheckCat(e.target.value)} className="bg-dark-bg border border-gray-700 rounded px-2 text-sm text-white max-w-[80px]">
                                 <option value="證件/金錢">證件</option>
                                 <option value="電子產品">電子</option>
                                 <option value="盥洗/藥品">藥品</option>
                                 <option value="衣物">衣物</option>
                                 <option value="其他">其他</option>
                             </select>
                             <button onClick={addCheckItem} className="bg-gold-500 text-black px-3 rounded font-bold text-xl">+</button>
                         </div>

                         <div className="space-y-4">
                             {Array.from(new Set((trip.checklist || []).map(c => c.category || '未分類'))).map(cat => (
                                 <div key={cat} className="break-inside-avoid">
                                     <h4 className="text-xs font-bold text-gray-500 uppercase mb-2 border-b border-gray-800 pb-1">{cat}</h4>
                                     <div className="space-y-1">
                                         {(trip.checklist || []).filter(c => (c.category || '未分類') === cat).map(item => (
                                             <div key={item.id} onClick={() => toggleCheck(item.id)} className="flex items-center gap-3 p-2 hover:bg-white/5 rounded cursor-pointer group">
                                                 <div className={`w-5 h-5 rounded border flex items-center justify-center ${item.checked ? 'bg-gold-500 border-gold-500' : 'border-gray-600'}`}>
                                                     {item.checked && <Icons.CheckCircle size={14} className="text-black" />}
                                                 </div>
                                                 <span className={`flex-1 text-sm ${item.checked ? 'line-through text-gray-600' : 'text-gray-300'}`}>{item.text}</span>
                                                 <button onClick={(e) => {e.stopPropagation(); deleteCheckItem(item.id);}} className="text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 no-print"><Icons.Trash size={14}/></button>
                                             </div>
                                         ))}
                                     </div>
                                 </div>
                             ))}
                         </div>
                     </Card>

                     {/* Memo */}
                     <Card>
                         <h3 className="text-lg font-bold text-white mb-3">個人備忘錄 (Memo)</h3>
                         <textarea 
                            value={trip.memo || ''} 
                            onChange={handleMemoChange} 
                            placeholder="輸入筆記、網址連結..." 
                            className="w-full h-32 bg-dark-bg border border-gray-700 rounded-xl p-3 text-sm text-white outline-none focus:border-gold-500"
                         ></textarea>
                         {memoLinks.length > 0 && (
                             <div className="mt-4 flex flex-wrap gap-2">
                                 {memoLinks.map((link, i) => (
                                     <a key={i} href={link} target="_blank" className="flex items-center gap-1 bg-blue-900/30 text-blue-300 px-3 py-1.5 rounded-lg text-xs border border-blue-500/30 truncate max-w-full">
                                         <Icons.Navigation size={12} /> {new URL(link).hostname}
                                     </a>
                                 ))}
                             </div>
                         )}
                     </Card>
                </div>
            )}

            {/* BOOKING MODAL - HIDE IN PRINT */}
            <div className="no-print">
            <Modal isOpen={isBookingModalOpen} onClose={() => setIsBookingModalOpen(false)} title={bookingMode === 'add' ? (bookingType === 'flight' ? '新增航班' : '新增住宿') : '編輯預訂'}>
                <div className="space-y-3">
                    <div>
                        <label className="block text-xs text-gold-500 mb-1">日期</label>
                        <select 
                            value={bookingForm.date || ''} 
                            onChange={e => setBookingForm({...bookingForm, date: e.target.value})}
                            className="w-full bg-dark-bg border border-gray-700 rounded-lg p-3 text-white outline-none"
                        >
                            {(trip.itinerary || []).map(d => <option key={d.date} value={d.date}>{formatDate(d.date)}</option>)}
                        </select>
                    </div>

                    {bookingType === 'flight' ? (
                        <>
                             <div className="grid grid-cols-2 gap-3">
                                 <div><label className="text-xs text-gray-500">航空公司</label><input value={bookingDetails.airline || ''} onChange={e => setBookingDetails({...bookingDetails, airline: e.target.value})} className="w-full bg-dark-bg border border-gray-700 rounded p-2 text-white text-sm" placeholder="長榮航空"/></div>
                                 <div><label className="text-xs text-gray-500">航班代號</label><input value={bookingDetails.flightNumber || ''} onChange={e => setBookingDetails({...bookingDetails, flightNumber: e.target.value})} className="w-full bg-dark-bg border border-gray-700 rounded p-2 text-white text-sm" placeholder="BR123"/></div>
                             </div>
                             <div className="grid grid-cols-2 gap-3">
                                 <div><label className="text-xs text-gray-500">出發機場 (代碼)</label><input value={bookingForm.location || ''} onChange={e => setBookingForm({...bookingForm, location: e.target.value})} className="w-full bg-dark-bg border border-gray-700 rounded p-2 text-white text-sm" placeholder="TPE"/></div>
                                 <div><label className="text-xs text-gray-500">抵達機場 (代碼)</label><input value={bookingForm.activity || ''} onChange={e => setBookingForm({...bookingForm, activity: e.target.value})} className="w-full bg-dark-bg border border-gray-700 rounded p-2 text-white text-sm" placeholder="抵達 KIX"/></div>
                             </div>
                             <div className="grid grid-cols-3 gap-2">
                                 <div><label className="text-xs text-gray-500">航廈</label><input value={bookingDetails.terminal || ''} onChange={e => setBookingDetails({...bookingDetails, terminal: e.target.value})} className="w-full bg-dark-bg border border-gray-700 rounded p-2 text-white text-sm"/></div>
                                 <div><label className="text-xs text-gray-500">登機門</label><input value={bookingDetails.gate || ''} onChange={e => setBookingDetails({...bookingDetails, gate: e.target.value})} className="w-full bg-dark-bg border border-gray-700 rounded p-2 text-white text-sm"/></div>
                                 <div><label className="text-xs text-gray-500">座位</label><input value={bookingDetails.seat || ''} onChange={e => setBookingDetails({...bookingDetails, seat: e.target.value})} className="w-full bg-dark-bg border border-gray-700 rounded p-2 text-white text-sm"/></div>
                             </div>
                             <div className="grid grid-cols-2 gap-3">
                                 <div>
                                     <label className="text-xs text-gray-500">起飛時間</label>
                                     <input type="time" value={bookingForm.time || ''} onChange={e => setBookingForm({...bookingForm, time: e.target.value})} className="w-full bg-dark-bg border border-gray-700 rounded p-2 text-white text-sm"/>
                                 </div>
                                 <div>
                                     <label className="text-xs text-gray-500">抵達時間</label>
                                     <input type="time" value={bookingForm.endTime || ''} onChange={e => setBookingForm({...bookingForm, endTime: e.target.value})} className="w-full bg-dark-bg border border-gray-700 rounded p-2 text-white text-sm"/>
                                 </div>
                             </div>
                        </>
                    ) : (
                        <>
                             <div><label className="text-xs text-gray-500">飯店名稱</label><input value={bookingForm.location || ''} onChange={e => setBookingForm({...bookingForm, location: e.target.value})} className="w-full bg-dark-bg border border-gray-700 rounded p-2 text-white text-sm"/></div>
                             <div><label className="text-xs text-gray-500">地址</label><input value={bookingForm.activity || ''} onChange={e => setBookingForm({...bookingForm, activity: e.target.value})} className="w-full bg-dark-bg border border-gray-700 rounded p-2 text-white text-sm"/></div>
                             <div className="grid grid-cols-2 gap-3">
                                 <div><label className="text-xs text-gray-500">入住時間</label><input type="time" value={bookingDetails.checkInTime || ''} onChange={e => setBookingDetails({...bookingDetails, checkInTime: e.target.value})} className="w-full bg-dark-bg border border-gray-700 rounded p-2 text-white text-sm"/></div>
                                 <div><label className="text-xs text-gray-500">退房時間</label><input type="time" value={bookingDetails.checkOutTime || ''} onChange={e => setBookingDetails({...bookingDetails, checkOutTime: e.target.value})} className="w-full bg-dark-bg border border-gray-700 rounded p-2 text-white text-sm"/></div>
                             </div>
                             <div className="grid grid-cols-2 gap-3">
                                 <div><label className="text-xs text-gray-500">總金額</label><input type="number" value={bookingForm.cost || ''} onChange={e => setBookingForm({...bookingForm, cost: parseFloat(e.target.value)})} className="w-full bg-dark-bg border border-gray-700 rounded p-2 text-white text-sm"/></div>
                                 <div><label className="text-xs text-gray-500">人數 (分攤計算)</label><input type="number" value={bookingDetails.guests || 2} onChange={e => setBookingDetails({...bookingDetails, guests: parseInt(e.target.value)})} className="w-full bg-dark-bg border border-gray-700 rounded p-2 text-white text-sm"/></div>
                             </div>
                             <div className="space-y-2">
                                 <label className="text-xs text-gray-500">飯店照片</label>
                                 <input type="file" accept="image/*" onChange={handleBookingFile} className="text-xs text-gray-400 w-full"/>
                                 {bookingForm.bookingImage && <div className="h-20 bg-gray-800 rounded overflow-hidden"><img src={bookingForm.bookingImage} className="h-full object-cover"/></div>}
                             </div>
                        </>
                    )}

                    <Button onClick={handleSaveBooking} className="w-full mt-4">儲存</Button>
                </div>
            </Modal>

            {/* Voucher Add/Edit Modal */}
            <Modal isOpen={isVoucherModalOpen} onClose={() => setIsVoucherModalOpen(false)} title={voucherMode === 'add' ? '新增票券' : '編輯票券'}>
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs text-gold-500 mb-1">票券名稱</label>
                        <input value={voucherForm.title || ''} onChange={e => setVoucherForm({...voucherForm, title: e.target.value})} placeholder="例如：迪士尼門票" className="w-full bg-dark-bg border border-gray-700 rounded-lg p-3 text-white outline-none focus:border-gold-500" />
                    </div>
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm text-gold-500 font-bold mb-1"><Icons.Paperclip size={16} /> 上傳憑證 (圖片/PDF)</label>
                        <input type="file" accept="image/*,.pdf" onChange={handleVoucherFile} className="text-xs text-gray-400 w-full file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-gold-500 file:text-black hover:file:bg-gold-600"/>
                        {voucherForm.fileName && <div className="text-xs text-green-400">已選擇: {voucherForm.fileName}</div>}
                    </div>
                    <Button onClick={handleSaveVoucher} className="w-full mt-4">儲存</Button>
                </div>
            </Modal>

            {/* Voucher View Modal */}
            {viewingVoucher && (
                <div className="fixed inset-0 bg-black/95 z-[70] flex items-center justify-center p-4 animate-fade-in no-print" onClick={() => setViewingVoucher(null)}>
                    <div className="relative w-full max-w-4xl h-[80vh] flex flex-col items-center justify-center" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setViewingVoucher(null)} className="absolute -top-12 right-0 text-white p-2 z-50"><Icons.Plus size={32} className="rotate-45" /></button>
                        {viewingVoucher.fileType === 'pdf' ? (
                            <iframe src={viewingVoucher.image} className="w-full h-full bg-white rounded-lg" />
                        ) : (
                            <img src={viewingVoucher.image} className="max-w-full max-h-full rounded-lg object-contain" />
                        )}
                        <div className="absolute bottom-4 bg-black/50 px-4 py-2 rounded-full text-white font-bold">{viewingVoucher.title}</div>
                    </div>
                </div>
            )}
            </div>
        </div>
    );
};

const GuideView = ({ trip, updateTrip }: { trip: Trip; updateTrip: (t: Trip) => void }) => {
    const [loading, setLoading] = useState(false);
    const [activeSection, setActiveSection] = useState<'attractions' | 'restaurants' | 'hidden'>('attractions');

    const handleGenerate = async () => {
        setLoading(true);
        try {
            const guide = await analyzeItinerary(trip);
            updateTrip({ ...trip, advancedGuide: guide });
        } catch (e) {
            alert("AI 分析失敗，請檢查 API Key 或稍後再試。");
        } finally {
            setLoading(false);
        }
    };

    if (!trip.advancedGuide) {
        return (
            <div className="flex flex-col items-center justify-center py-20 px-4 text-center animate-fade-in">
                <div className="bg-gradient-to-br from-gold-500/20 to-purple-500/20 p-8 rounded-full mb-6 relative">
                    <Icons.Sparkles size={64} className="text-gold-400" />
                    <div className="absolute inset-0 bg-white/20 blur-xl rounded-full animate-pulse"></div>
                </div>
                <h2 className="text-2xl font-bold text-white mb-2 font-serif">AI 智能導遊</h2>
                <p className="text-gray-400 max-w-xs mb-8">讓 AI 分析您的行程，提供深度景點介紹、必吃美食推薦以及隱藏版打卡點。</p>
                <Button onClick={handleGenerate} disabled={loading} className="w-full max-w-xs">
                    {loading ? <div className="flex items-center gap-2"><div className="animate-spin h-4 w-4 border-2 border-black rounded-full border-t-transparent"></div> 分析中...</div> : <><Icons.Sparkles size={20}/> 開始分析行程</>}
                </Button>
            </div>
        );
    }

    const { attractions, restaurants, hiddenGems } = trip.advancedGuide;

    return (
        <div className="pb-24 animate-fade-in">
             <div className="flex justify-center gap-2 mb-6 sticky top-16 bg-dark-bg/95 py-2 z-40 no-print overflow-x-auto no-scrollbar">
                {[
                    { id: 'attractions', label: '景點深度遊', icon: Icons.Camera },
                    { id: 'restaurants', label: '美食推薦', icon: Icons.Utensils },
                    { id: 'hidden', label: '隱藏亮點', icon: Icons.MapPin }
                ].map((t) => (
                    <button 
                        key={t.id}
                        onClick={() => setActiveSection(t.id as any)}
                        className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${activeSection === t.id ? 'bg-gold-500 text-black shadow-lg shadow-gold-500/20' : 'text-gray-500 bg-dark-surface'}`}
                    >
                        <t.icon size={14} /> {t.label}
                    </button>
                ))}
            </div>

            <div className="space-y-6">
                {activeSection === 'attractions' && attractions?.map((item, i) => (
                    <Card key={i} className="break-inside-avoid">
                        <div className="flex justify-between items-start mb-2">
                             <h3 className="text-xl font-bold text-white">{item.name}</h3>
                             <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.locationQuery)}`} target="_blank" className="text-gold-500 bg-gold-500/10 p-2 rounded-full"><Icons.Navigation size={16}/></a>
                        </div>
                        <div className="flex flex-wrap gap-2 mb-3">
                            {item.tags?.map(t => <span key={t} className="text-[10px] bg-gray-800 text-gray-300 px-2 py-1 rounded-full border border-gray-700">{t}</span>)}
                        </div>
                        <p className="text-gray-300 text-sm leading-relaxed mb-4">{item.description}</p>
                        
                        <div className="bg-dark-bg p-3 rounded-lg border border-gray-700 space-y-2">
                            <div className="flex gap-2 text-xs">
                                <Icons.Camera size={14} className="text-gold-500 mt-0.5 shrink-0"/>
                                <div><span className="text-gray-500 block mb-0.5 font-bold">最佳拍照點</span>{item.photoSpots?.join('、')}</div>
                            </div>
                            {item.restroomTip && (
                                <div className="flex gap-2 text-xs pt-2 border-t border-gray-800">
                                    <Icons.Info size={14} className="text-blue-400 mt-0.5 shrink-0"/>
                                    <div><span className="text-gray-500 block mb-0.5 font-bold">貼心提醒</span>{item.restroomTip}</div>
                                </div>
                            )}
                        </div>
                    </Card>
                ))}

                {activeSection === 'restaurants' && restaurants?.map((item, i) => (
                     <Card key={i} className="break-inside-avoid">
                        <div className="flex justify-between items-start mb-2">
                             <div>
                                 <h3 className="text-xl font-bold text-white">{item.name}</h3>
                                 <div className="flex items-center gap-2 mt-1">
                                     <span className="bg-yellow-500/20 text-yellow-500 text-xs px-1.5 py-0.5 rounded font-bold flex items-center gap-1"><Icons.Star size={10} fill="currentColor"/> {item.rating}</span>
                                     <span className="text-xs text-gray-500">{item.type}</span>
                                 </div>
                             </div>
                             <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.locationQuery)}`} target="_blank" className="text-gold-500 bg-gold-500/10 p-2 rounded-full"><Icons.Navigation size={16}/></a>
                        </div>
                        <p className="text-gray-300 text-sm mb-4 line-clamp-2">{item.description}</p>
                        <div className="bg-dark-bg p-3 rounded-lg border border-gray-700">
                            <div className="text-xs text-gold-500 font-bold mb-2">必點推薦</div>
                            <div className="flex flex-wrap gap-2">
                                {item.mustOrder?.map(f => <span key={f} className="text-xs text-white bg-gray-800 px-2 py-1 rounded border border-gray-700">{f}</span>)}
                            </div>
                        </div>
                     </Card>
                ))}

                {activeSection === 'hidden' && hiddenGems?.map((item, i) => (
                    <Card key={i} className="border-purple-500/30 break-inside-avoid">
                         <div className="flex justify-between items-start mb-2">
                             <h3 className="text-xl font-bold text-white flex items-center gap-2"><Icons.Sparkles size={20} className="text-purple-400"/> {item.name}</h3>
                             <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.locationQuery)}`} target="_blank" className="text-gold-500 bg-gold-500/10 p-2 rounded-full"><Icons.Navigation size={16}/></a>
                        </div>
                        <p className="text-gray-300 text-sm leading-relaxed mb-4">{item.description}</p>
                        <div className="bg-purple-900/10 p-3 rounded-lg border border-purple-500/20">
                             <div className="flex gap-2 text-xs">
                                <Icons.Camera size={14} className="text-purple-400 mt-0.5 shrink-0"/>
                                <div><span className="text-gray-500 block mb-0.5 font-bold">隱藏拍攝角度</span>{item.photoSpots?.join('、')}</div>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>
            
            <div className="mt-8 text-center">
                 <Button onClick={handleGenerate} variant="ghost" className="text-sm opacity-50 hover:opacity-100">
                    <Icons.Sparkles size={16} className="mr-2"/> 重新分析
                 </Button>
            </div>
        </div>
    );
};

const App = () => {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [currentTripId, setCurrentTripId] = useState<string | null>(null);
  const [view, setView] = useState<'home' | 'trip'>('home');
  const [activeTab, setActiveTab] = useState<Tab>(Tab.ITINERARY);
  const [loading, setLoading] = useState(false);
  
  // Create Trip Form State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [dest, setDest] = useState('');
  const [date, setDate] = useState('');
  const [days, setDays] = useState(5);

  // Initial Load
  useEffect(() => {
    // 1. Check URL for Shared Data
    const params = new URLSearchParams(window.location.search);
    const shareData = params.get('share');
    if (shareData) {
        try {
            const sharedTrip = JSON.parse(LZString.decompressFromEncodedURIComponent(shareData) || '');
            if (sharedTrip && sharedTrip.destination) {
                const newId = generateId();
                const importedTrip = { 
                    ...sharedTrip, 
                    id: newId, 
                    destination: `${sharedTrip.destination} (Shared)`,
                    // Sanitize large fields if needed
                };
                setTrips(prev => {
                    const exists = prev.some(t => t.id === importedTrip.id);
                    return exists ? prev : [...prev, importedTrip];
                });
                setCurrentTripId(newId);
                setView('trip');
                // Clean URL
                window.history.replaceState({}, '', window.location.pathname);
                return;
            }
        } catch(e) { console.error("Share Import Failed", e); }
    }

    // 2. Load Local Storage
    const savedTrips = localStorage.getItem('voyage-trips');
    if (savedTrips) {
        try {
            const parsed = JSON.parse(savedTrips);
            if (Array.isArray(parsed)) {
                setTrips(parsed);
            }
        } catch(e) {
            console.error("Failed to parse saved trips", e);
        }
    } else {
        // Migration: Check for old single trip
        const oldTrip = localStorage.getItem('gemini-trip-v1');
        if (oldTrip) {
            try {
                const parsed = JSON.parse(LZString.decompressFromUTF16(oldTrip) || 'null');
                if (parsed) setTrips([parsed]);
            } catch(e) {}
        }
    }
  }, []);

  // Sync to LocalStorage
  useEffect(() => {
      localStorage.setItem('voyage-trips', JSON.stringify(trips));
  }, [trips]);

  const updateCurrentTrip = (updatedTrip: Trip) => {
      setTrips(prev => prev.map(t => t.id === updatedTrip.id ? updatedTrip : t));
  };

  const handleCreateTrip = async () => {
      if (!dest || !date) return alert("請輸入目的地與日期");
      setLoading(true);
      try {
          const month = new Date(date).toLocaleString('en-US', { month: 'long' });
          const info = await fetchDestinationInfo(dest, month, days);
          
          const startDate = new Date(date);
          const endDate = new Date(date);
          endDate.setDate(endDate.getDate() + days - 1);

          const newTrip: Trip = {
              id: generateId(),
              destination: dest,
              startDate: date,
              endDate: endDate.toISOString().split('T')[0],
              duration: days,
              currencyCode: info.currencyCode,
              exchangeRate: info.exchangeRate,
              budget: 50000,
              budgets: [],
              expenses: [],
              itinerary: Array.from({ length: days }).map((_, i) => {
                  const d = new Date(date);
                  d.setDate(d.getDate() + i);
                  return { date: d.toISOString().split('T')[0], items: [] };
              }),
              checklist: DEFAULT_CHECKLIST_ITEMS.flatMap(c => c.items.map(i => ({ id: generateId(), text: i, category: c.category, checked: false }))),
              weather: info.weather,
              dailyWeather: info.dailyWeather,
              notes: '',
              guideContent: info.guide,
              emergency: info.emergency,
              tips: info.tips,
              vouchers: []
          };
          setTrips(prev => [...prev, newTrip]);
          setCurrentTripId(newTrip.id);
          setView('trip');
          setShowCreateModal(false);
          setDest(''); setDate('');
      } catch (e) {
          console.error(e);
          alert("建立失敗，請稍後再試");
      } finally {
          setLoading(false);
      }
  };
  
  const handleDeleteTrip = (id: string) => {
      if(confirm("確定刪除此行程？此動作無法復原。")) {
          setTrips(prev => prev.filter(t => t.id !== id));
          if (currentTripId === id) {
              setCurrentTripId(null);
              setView('home');
          }
      }
  };

  const handleExportFile = (t: Trip) => {
       const data = LZString.compressToUTF16(JSON.stringify(t));
       const blob = new Blob([data], { type: 'text/plain' });
       const url = URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       a.download = `trip-${t.destination}-${t.startDate}.gemini`;
       a.click();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
              try {
                  const content = ev.target?.result as string;
                  const parsed = JSON.parse(LZString.decompressFromUTF16(content) || content);
                  if (parsed.id && parsed.itinerary) {
                      parsed.id = generateId(); // Avoid ID conflicts
                      setTrips(prev => [...prev, parsed]);
                  } else {
                      alert("無效的檔案格式");
                  }
              } catch (e) {
                  alert("讀取檔案失敗");
              }
          };
          reader.readAsText(file);
      }
  };
  
  const handleShareLink = (t: Trip) => {
      // Create a light version for sharing (remove heavy images)
      const lightTrip = {
          ...t,
          itinerary: t.itinerary.map(d => ({
              ...d,
              items: d.items.map(i => ({ ...i, bookingImage: undefined }))
          })),
          expenses: t.expenses.map(e => ({ ...e, photo: undefined })),
          vouchers: [] // remove vouchers
      };
      
      try {
          const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(lightTrip));
          const url = `${window.location.origin}${window.location.pathname}?share=${compressed}`;
          
          if (url.length > 8000) {
              alert("行程資料過大，無法產生分享連結。建議使用匯出檔案功能。");
              return;
          }
          
          navigator.clipboard.writeText(url).then(() => alert("連結已複製！(註：圖片不會包含在連結中)")).catch(() => prompt("請複製連結", url));
      } catch(e) {
          alert("產生連結失敗");
      }
  };

  const currentTrip = trips.find(t => t.id === currentTripId);

  // --- Views ---

  if (view === 'home' || !currentTrip) {
      return (
          <div className="min-h-screen bg-black text-white p-6 relative overflow-hidden font-sans">
              <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?ixlib=rb-4.0.3&auto=format&fit=crop&w=2021&q=80')] bg-cover bg-center opacity-20"></div>
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-transparent"></div>
              
              <div className="relative z-10 max-w-4xl mx-auto">
                  <header className="flex justify-between items-center mb-10">
                      <div>
                          <h1 className="text-4xl font-serif font-bold text-transparent bg-clip-text bg-gradient-to-r from-gold-300 to-gold-600">Voyage AI</h1>
                          <p className="text-gray-400 text-sm mt-1">您的智能旅遊管家</p>
                      </div>
                      <div className="flex gap-2">
                          <label className="bg-dark-surface hover:bg-gray-800 text-gray-300 px-4 py-2 rounded-xl text-sm font-bold border border-gray-700 cursor-pointer flex items-center gap-2 transition-colors">
                              <Icons.Download size={16}/> 匯入
                              <input type="file" accept=".gemini,.txt" onChange={handleImportFile} className="hidden" />
                          </label>
                          <button onClick={() => setShowCreateModal(true)} className="bg-gradient-to-r from-gold-500 to-gold-600 text-black px-4 py-2 rounded-xl text-sm font-bold shadow-lg hover:shadow-gold-500/20 transition-all flex items-center gap-2">
                              <Icons.Plus size={18}/> 新增旅程
                          </button>
                      </div>
                  </header>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {trips.map(t => (
                          <div key={t.id} className="group relative bg-dark-card/60 backdrop-blur-md border border-white/10 hover:border-gold-500/50 rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-black/50">
                              <div className="flex justify-between items-start mb-4">
                                  <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-3 rounded-xl border border-white/5 group-hover:border-gold-500/30 transition-colors">
                                      <Icons.Map size={24} className="text-gray-400 group-hover:text-gold-500 transition-colors" />
                                  </div>
                                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button onClick={() => handleExportFile(t)} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full" title="匯出檔案"><Icons.Download size={16}/></button>
                                      <button onClick={() => handleShareLink(t)} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full" title="分享連結"><Icons.Share size={16}/></button>
                                      <button onClick={() => handleDeleteTrip(t.id)} className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-full" title="刪除"><Icons.Trash size={16}/></button>
                                  </div>
                              </div>
                              <h3 className="text-xl font-bold text-white mb-1">{t.destination}</h3>
                              <p className="text-sm text-gray-400 mb-4">{t.startDate} • {t.duration} Days</p>
                              <button onClick={() => { setCurrentTripId(t.id); setView('trip'); }} className="w-full py-3 bg-white/5 hover:bg-gold-500 hover:text-black text-gray-300 rounded-xl text-sm font-bold transition-colors">
                                  進入行程
                              </button>
                          </div>
                      ))}
                      
                      {trips.length === 0 && (
                          <div className="col-span-full py-20 text-center border-2 border-dashed border-gray-800 rounded-2xl">
                              <Icons.Plane size={48} className="mx-auto text-gray-700 mb-4" />
                              <p className="text-gray-500">尚無旅程規劃</p>
                              <button onClick={() => setShowCreateModal(true)} className="text-gold-500 font-bold mt-2 hover:underline">立即開始</button>
                          </div>
                      )}
                  </div>
              </div>

              {/* Create Modal */}
              <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="新增旅程">
                  <div className="space-y-4">
                      <div>
                          <label className="block text-xs text-gold-500 font-bold mb-1">目的地</label>
                          <input value={dest} onChange={e => setDest(e.target.value)} placeholder="例如：東京, 日本" className="w-full bg-dark-bg border border-gray-700 rounded-lg p-3 text-white outline-none focus:border-gold-500" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                          <div>
                              <label className="block text-xs text-gold-500 font-bold mb-1">出發日期</label>
                              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full bg-dark-bg border border-gray-700 rounded-lg p-3 text-white outline-none focus:border-gold-500" />
                          </div>
                          <div>
                              <label className="block text-xs text-gold-500 font-bold mb-1">天數</label>
                              <input type="number" min="1" max="30" value={days} onChange={e => setDays(parseInt(e.target.value))} className="w-full bg-dark-bg border border-gray-700 rounded-lg p-3 text-white outline-none focus:border-gold-500" />
                          </div>
                      </div>
                      <Button onClick={handleCreateTrip} disabled={loading} className="w-full mt-4">
                          {loading ? "AI 規劃中..." : "開始規劃"}
                      </Button>
                  </div>
              </Modal>
          </div>
      );
  }

  // --- Trip View ---

  return (
    <div className="min-h-screen bg-dark-bg text-white font-sans selection:bg-gold-500/30 pb-safe">
        {/* Header - HIDE IN PRINT */}
        <header className="sticky top-0 z-50 bg-dark-bg/80 backdrop-blur-md border-b border-gray-800 px-4 py-3 flex items-center no-print">
            <button onClick={() => setView('home')} className="p-2 -ml-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors">
                <Icons.ArrowLeft size={20} />
            </button>
            <div className="ml-2">
                <h1 className="font-bold text-lg font-serif leading-none">{currentTrip.destination}</h1>
                <p className="text-[10px] text-gray-400 font-mono mt-0.5">{currentTrip.startDate} • {currentTrip.duration} Days</p>
            </div>
        </header>

        <main className="max-w-md mx-auto p-4">
             {/* Print Header - SHOW ONLY IN PRINT */}
             <div className="hidden print:block mb-8 border-b-2 border-black pb-4 text-center">
                 <h1 className="text-4xl font-bold text-black mb-2">{currentTrip.destination} 旅遊計畫</h1>
                 <p className="text-gray-600 text-lg">{currentTrip.startDate} ~ {currentTrip.endDate} ({currentTrip.duration} 天)</p>
             </div>

            {activeTab === Tab.ITINERARY && <ItineraryView trip={currentTrip} updateTrip={updateCurrentTrip} />}
            {activeTab === Tab.EXPENSE && <ExpenseView trip={currentTrip} updateTrip={updateCurrentTrip} />}
            {activeTab === Tab.INFO && <InfoView trip={currentTrip} updateTrip={updateCurrentTrip} />}
            {activeTab === Tab.GUIDE && <GuideView trip={currentTrip} updateTrip={updateCurrentTrip} />}
            
            {/* Print All Sections Logic: When printing, ideally show all. 
                Currently, user prints 'current view'. For full PDF export, usually easier to render all components if isPrinting.
                Let's auto-render all if printing? CSS can't detect print button click easily. 
                Standard approach: User prints the current tab. 
                Enhanced approach: Add a specific "Print All" button that toggles a state?
                For now, sticking to current view print to keep DOM light, but ensuring Itinerary print works great.
            */}
        </main>

        {/* Tab Bar - HIDE IN PRINT */}
        <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-dark-card/90 backdrop-blur-xl border border-gold-500/20 rounded-full px-6 py-4 shadow-2xl flex gap-8 z-50 no-print max-w-[90vw]">
            {[
                { id: Tab.ITINERARY, icon: Icons.Map, label: '行程' },
                { id: Tab.EXPENSE, icon: Icons.Wallet, label: '記帳' },
                { id: Tab.INFO, icon: Icons.Info, label: '資訊' },
                { id: Tab.GUIDE, icon: Icons.Sparkles, label: '導遊' },
            ].map(t => (
                <button 
                    key={t.id} 
                    onClick={() => setActiveTab(t.id)} 
                    className={`flex flex-col items-center gap-1 transition-all duration-300 relative group ${activeTab === t.id ? 'text-gold-400 -translate-y-1' : 'text-gray-500 hover:text-gray-300'}`}
                >
                    <div className={`absolute -inset-2 bg-gold-500/20 rounded-full blur-md transition-opacity ${activeTab === t.id ? 'opacity-100' : 'opacity-0'}`}></div>
                    <t.icon size={24} className={`relative z-10 transition-transform ${activeTab === t.id ? 'scale-110' : ''}`} strokeWidth={activeTab === t.id ? 2.5 : 2} />
                    <span className="text-[10px] font-bold relative z-10">{t.label}</span>
                    {activeTab === t.id && <div className="absolute -bottom-2 w-1 h-1 bg-gold-500 rounded-full"></div>}
                </button>
            ))}
        </nav>
    </div>
  );
};

export default App;