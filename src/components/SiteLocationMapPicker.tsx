import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  MapPin,
  Plus,
  Trash2,
  Crosshair,
  Navigation,
  CheckCircle2,
  ExternalLink,
  Layers,
} from 'lucide-react';
import type { ProjectSite } from '../types';

interface SiteLocationMapPickerProps {
  sites: ProjectSite[];
  onChange: (sites: ProjectSite[]) => void;
  disabled?: boolean;
}

const INDONESIA_PRESETS = [
  { name: 'Balikpapan / Sector 4', lat: -1.265386, lng: 116.8312 },
  { name: 'IKN Nusantara', lat: -0.970035, lng: 116.707758 },
  { name: 'DKI Jakarta', lat: -6.208763, lng: 106.845599 },
  { name: 'Surabaya Port', lat: -7.199722, lng: 112.733056 },
  { name: 'Makassar New Port', lat: -5.118611, lng: 119.414444 },
  { name: 'Cilegon Industrial', lat: -6.017778, lng: 106.053889 },
];

export const SiteLocationMapPicker: React.FC<SiteLocationMapPickerProps> = ({
  sites,
  onChange,
  disabled = false,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);

  const [activeSiteId, setActiveSiteId] = useState<string | null>(
    sites[0]?.id || null
  );

  // Helper to create sharp HTML DivIcon
  const createSiteIcon = (label: string, isPrimary: boolean, isSelected: boolean) => {
    const bgColor = isPrimary ? '#2563eb' : '#0f172a';
    const borderColor = isSelected ? '#d4f038' : isPrimary ? '#93c5fd' : '#475569';
    const scale = isSelected ? '1.08' : '1.0';

    return L.divIcon({
      className: 'custom-site-pin',
      html: `
        <div style="display:flex; flex-direction:column; align-items:center; transform:translate(-50%, -100%) scale(${scale}); transition:transform 0.15s ease;">
          <div style="background:${bgColor}; color:#ffffff; font-weight:700; font-size:11px; padding:3px 8px; border-radius:6px; box-shadow:0 3px 10px rgba(0,0,0,0.35); border:2px solid ${borderColor}; white-space:nowrap; display:flex; align-items:center; gap:5px;">
            <span style="font-size:12px;">📍</span>
            <span>${label}</span>
            ${isPrimary ? '<span style="font-size:9px; background:#1d4ed8; padding:1px 4px; border-radius:3px;">UTAMA</span>' : ''}
          </div>
          <div style="width:0; height:0; border-left:6px solid transparent; border-right:6px solid transparent; border-top:7px solid ${bgColor};"></div>
        </div>
      `,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  };

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialLat = sites[0]?.latitude || -1.265386;
    const initialLng = sites[0]?.longitude || 116.8312;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLng],
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    }).addTo(map);

    const markersGroup = L.layerGroup().addTo(map);
    markersGroupRef.current = markersGroup;
    mapInstanceRef.current = map;

    // Invalidate size once visible
    setTimeout(() => {
      map.invalidateSize();
    }, 250);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update map markers when sites change or active site changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersGroup = markersGroupRef.current;
    if (!map || !markersGroup) return;

    markersGroup.clearLayers();

    sites.forEach((site) => {
      const isSelected = site.id === activeSiteId;
      const marker = L.marker([site.latitude, site.longitude], {
        icon: createSiteIcon(site.name || 'Titik Site', Boolean(site.isPrimary), isSelected),
        draggable: !disabled,
      });

      marker.on('click', () => {
        setActiveSiteId(site.id);
      });

      marker.on('dragend', (e) => {
        const newLatLng = (e.target as L.Marker).getLatLng();
        handleUpdateSiteCoordinate(site.id, newLatLng.lat, newLatLng.lng);
      });

      marker.bindTooltip(
        `<b>${site.name}</b><br><span style="font-size:10px; color:#64748b;">${site.latitude.toFixed(6)}, ${site.longitude.toFixed(6)}</span>`,
        { direction: 'top', offset: [0, -28] }
      );

      marker.addTo(markersGroup);
    });

    // Map click handler to relocate active site or add new site
    const onMapClick = (e: L.LeafletMouseEvent) => {
      if (disabled) return;
      if (activeSiteId) {
        handleUpdateSiteCoordinate(activeSiteId, e.latlng.lat, e.latlng.lng);
      } else {
        handleAddSiteWithCoordinate(e.latlng.lat, e.latlng.lng);
      }
    };

    map.off('click');
    map.on('click', onMapClick);
  }, [sites, activeSiteId, disabled]);

  const handleUpdateSiteCoordinate = (siteId: string, lat: number, lng: number) => {
    const updated = sites.map((s) => {
      if (s.id === siteId) {
        return {
          ...s,
          latitude: Math.round(lat * 1000000) / 1000000,
          longitude: Math.round(lng * 1000000) / 1000000,
        };
      }
      return s;
    });
    onChange(updated);
  };

  const handleAddSite = () => {
    const center = mapInstanceRef.current?.getCenter() || { lat: -1.265386, lng: 116.8312 };
    handleAddSiteWithCoordinate(center.lat, center.lng);
  };

  const handleAddSiteWithCoordinate = (lat: number, lng: number) => {
    const nextIndex = sites.length + 1;
    const newSiteId = `site-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newSite: ProjectSite = {
      id: newSiteId,
      name: `Site Lokasi #${nextIndex}`,
      code: `LOC-0${nextIndex}`,
      address: '',
      latitude: Math.round(lat * 1000000) / 1000000,
      longitude: Math.round(lng * 1000000) / 1000000,
      isPrimary: sites.length === 0,
      radiusMeters: 500,
    };

    const nextSites = [...sites, newSite];
    onChange(nextSites);
    setActiveSiteId(newSiteId);

    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([lat, lng], 14, { duration: 0.6 });
    }
  };

  const handleRemoveSite = (siteId: string) => {
    if (sites.length <= 1) {
      alert('Proyek minimal harus memiliki 1 titik lokasi site.');
      return;
    }
    const filtered = sites.filter((s) => s.id !== siteId);
    // If deleted site was primary, designate first remaining as primary
    if (filtered.length > 0 && !filtered.some((s) => s.isPrimary)) {
      filtered[0].isPrimary = true;
    }
    onChange(filtered);
    if (activeSiteId === siteId) {
      setActiveSiteId(filtered[0]?.id || null);
    }
  };

  const handleSetPrimary = (siteId: string) => {
    const updated = sites.map((s) => ({
      ...s,
      isPrimary: s.id === siteId,
    }));
    onChange(updated);
  };

  const handleUpdateSiteField = (siteId: string, field: keyof ProjectSite, value: any) => {
    const updated = sites.map((s) => {
      if (s.id === siteId) {
        return { ...s, [field]: value };
      }
      return s;
    });
    onChange(updated);
  };

  const handlePanToSite = (site: ProjectSite) => {
    setActiveSiteId(site.id);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([site.latitude, site.longitude], 15, {
        duration: 0.8,
      });
    }
  };

  const handlePresetSelect = (lat: number, lng: number) => {
    if (activeSiteId) {
      handleUpdateSiteCoordinate(activeSiteId, lat, lng);
    } else {
      handleAddSiteWithCoordinate(lat, lng);
    }
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([lat, lng], 13, { duration: 0.8 });
    }
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Browser Anda tidak mendukung deteksi lokasi Geolocation.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (activeSiteId) {
          handleUpdateSiteCoordinate(activeSiteId, latitude, longitude);
        } else {
          handleAddSiteWithCoordinate(latitude, longitude);
        }
        if (mapInstanceRef.current) {
          mapInstanceRef.current.flyTo([latitude, longitude], 15, { duration: 1.0 });
        }
      },
      (err) => {
        alert(`Gagal mengambil koordinat lokasi: ${err.message}`);
      },
      { timeout: 8000 }
    );
  };

  const activeSite = sites.find((s) => s.id === activeSiteId) || sites[0];

  return (
    <div className="space-y-4">
      {/* Map Control Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-slate-50 border border-slate-200 p-2.5 rounded-xl text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-slate-700 flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-blue-600" />
            <span>Preset Titik Lokasi:</span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {INDONESIA_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => handlePresetSelect(p.lat, p.lng)}
                className="px-2.5 py-1 rounded-md bg-white border border-slate-300 hover:border-blue-500 hover:text-blue-700 text-slate-700 font-medium text-[11px] transition-colors"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            className="px-2.5 py-1 rounded-md bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-medium text-[11px] flex items-center gap-1 transition-colors"
          >
            <Navigation className="w-3 h-3 text-emerald-600" />
            <span>GPS Saya</span>
          </button>
          {!disabled && (
            <button
              type="button"
              onClick={handleAddSite}
              className="px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] flex items-center gap-1 shadow-xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Titik Site</span>
            </button>
          )}
        </div>
      </div>

      {/* Grid: Map on Left/Top + Active Site Card / Site List */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Leaflet Map Canvas */}
        <div className="lg:col-span-7 xl:col-span-8 rounded-xl border border-slate-300 overflow-hidden shadow-2xs relative h-[360px] bg-slate-100">
          <div ref={mapContainerRef} className="w-full h-full z-0" />
          <div className="absolute bottom-2 left-2 z-10 bg-white/90 backdrop-blur-xs px-2.5 py-1 rounded-md border border-slate-300 text-[10px] text-slate-600 shadow-xs pointer-events-none">
            💡 <b>Tips:</b> Klik pada peta untuk geser titik aktif • Drag marker untuk koordinat presisi
          </div>
        </div>

        {/* Site List & Active Site Form */}
        <div className="lg:col-span-5 xl:col-span-4 flex flex-col space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900">
              Daftar Titik Site Proyek ({sites.length})
            </span>
            <span className="text-[10px] text-slate-400">Multiple Locations</span>
          </div>

          {/* List of Sites */}
          <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
            {sites.map((site) => {
              const isSelected = site.id === activeSite?.id;
              return (
                <div
                  key={site.id}
                  onClick={() => handlePanToSite(site)}
                  className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all flex items-center justify-between ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/40 text-blue-950 font-semibold shadow-2xs'
                      : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="flex items-center space-x-2 overflow-hidden">
                    <span className="text-sm">📍</span>
                    <div className="truncate">
                      <div className="flex items-center space-x-1.5 truncate">
                        <span className="truncate">{site.name || 'Tanpa Nama'}</span>
                        {site.isPrimary && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] bg-blue-600 text-white font-mono font-bold">
                            UTAMA
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 block font-mono">
                        {site.latitude.toFixed(4)}, {site.longitude.toFixed(4)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1 shrink-0 ml-2">
                    {!disabled && sites.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveSite(site.id);
                        }}
                        className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                        title="Hapus titik site"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selected Site Detail Form */}
          {activeSite && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900">
                  Edit Titik: <span className="text-blue-700">{activeSite.name}</span>
                </span>
                {!activeSite.isPrimary && !disabled && (
                  <button
                    type="button"
                    onClick={() => handleSetPrimary(activeSite.id)}
                    className="text-[10px] text-blue-600 hover:underline font-semibold"
                  >
                    Jadikan Lokasi Utama
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
                    Nama Lokasi / Site
                  </label>
                  <input
                    type="text"
                    disabled={disabled}
                    value={activeSite.name}
                    onChange={(e) => handleUpdateSiteField(activeSite.id, 'name', e.target.value)}
                    placeholder="misal: Main Terminal"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
                    Kode Site
                  </label>
                  <input
                    type="text"
                    disabled={disabled}
                    value={activeSite.code || ''}
                    onChange={(e) => handleUpdateSiteField(activeSite.id, 'code', e.target.value)}
                    placeholder="misal: JETTY-01"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white focus:ring-1 focus:ring-blue-500 uppercase"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
                  Alamat / Keterangan Lapangan
                </label>
                <input
                  type="text"
                  disabled={disabled}
                  value={activeSite.address || ''}
                  onChange={(e) => handleUpdateSiteField(activeSite.id, 'address', e.target.value)}
                  placeholder="misal: Jl. Pelabuhan KM 12, Balikpapan Barat"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
                    Latitude
                  </label>
                  <input
                    type="number"
                    step="0.000001"
                    disabled={disabled}
                    value={activeSite.latitude}
                    onChange={(e) =>
                      handleUpdateSiteCoordinate(
                        activeSite.id,
                        parseFloat(e.target.value) || 0,
                        activeSite.longitude
                      )
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-0.5">
                    Longitude
                  </label>
                  <input
                    type="number"
                    step="0.000001"
                    disabled={disabled}
                    value={activeSite.longitude}
                    onChange={(e) =>
                      handleUpdateSiteCoordinate(
                        activeSite.id,
                        activeSite.latitude,
                        parseFloat(e.target.value) || 0
                      )
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-mono"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
