'use client';

import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';

function makePinIcon({ favorited, selected, routeNum }) {
  const label = routeNum ? routeNum : favorited ? '' : '●';
  return L.divIcon({
    className: 'sale-pin-wrapper',
    html: `
      <div class="sale-pin ${favorited ? 'favorited' : ''} ${selected ? 'selected' : ''}">
        <div class="sign">${label}</div>
        <div class="stick"></div>
      </div>
    `,
    iconSize: [34, 40],
    iconAnchor: [17, 38],
  });
}

function Recenter({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView([center.lat, center.lng], map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.lat, center?.lng]);
  return null;
}

export default function LeafletMap({ sales, favorites, selectedSaleId, onSelectSale, center, interactive = true }) {
  const routeStops = useMemo(
    () => favorites.map((id) => sales.find((s) => s.id === id)).filter((s) => s && Number.isFinite(s.lat)),
    [favorites, sales]
  );

  const polylinePositions = routeStops.map((s) => [s.lat, s.lng]);

  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={13}
      style={{ width: '100%', height: '100%' }}
      zoomControl={false}
      attributionControl={interactive}
      dragging={interactive}
      scrollWheelZoom={interactive}
      doubleClickZoom={interactive}
      touchZoom={interactive}
      boxZoom={interactive}
      keyboard={interactive}
    >
      <Recenter center={center} />
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />

      {polylinePositions.length > 1 && (
        <Polyline positions={polylinePositions} pathOptions={{ color: '#D64545', weight: 3, dashArray: '6 6' }} />
      )}

      {sales
        .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
        .map((sale) => {
          const favIdx = favorites.indexOf(sale.id);
          const favorited = favIdx !== -1;
          return (
            <Marker
              key={sale.id}
              position={[sale.lat, sale.lng]}
              icon={makePinIcon({
                favorited,
                selected: sale.id === selectedSaleId,
                routeNum: favorited ? favIdx + 1 : null,
              })}
              eventHandlers={{ click: () => onSelectSale && onSelectSale(sale.id) }}
            />
          );
        })}
    </MapContainer>
  );
}
