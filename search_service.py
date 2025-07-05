import asyncio
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, text
from sqlalchemy.orm import selectinload
from models import Product, Shop, Brand, Category, ProductVariant
from schemas import SearchFilters, SearchResponse, Product as ProductSchema
import logging
import time

logger = logging.getLogger(__name__)

class SearchService:
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def search_products(
        self,
        filters: SearchFilters,
        page: int = 1,
        per_page: int = 50
    ) -> SearchResponse:
        """Search products with filters and pagination"""
        start_time = time.time()
        
        try:
            # Build base query
            query = select(Product).options(
                selectinload(Product.shop),
                selectinload(Product.brand),
                selectinload(Product.category),
                selectinload(Product.variants)
            )
            
            # Apply filters
            conditions = []
            filters_applied = {}
            
            # Text search in title, description, and search_text
            if filters.title:
                title_search = f"%{filters.title.lower()}%"
                conditions.append(
                    or_(
                        func.lower(Product.title).contains(title_search),
                        func.lower(Product.description).contains(title_search),
                        func.lower(Product.search_text).contains(title_search)
                    )
                )
                filters_applied['title'] = filters.title
            
            # Brand filter
            if filters.brand:
                brand_query = select(Brand.id).where(
                    func.lower(Brand.name).contains(filters.brand.lower())
                )
                brand_result = await self.db.execute(brand_query)
                brand_ids = [row[0] for row in brand_result]
                if brand_ids:
                    conditions.append(Product.brand_id.in_(brand_ids))
                    filters_applied['brand'] = filters.brand
            
            # Category filter
            if filters.category:
                category_query = select(Category.id).where(
                    or_(
                        func.lower(Category.name).contains(filters.category.lower()),
                        func.lower(Category.path).contains(filters.category.lower())
                    )
                )
                category_result = await self.db.execute(category_query)
                category_ids = [row[0] for row in category_result]
                if category_ids:
                    conditions.append(Product.category_id.in_(category_ids))
                    filters_applied['category'] = filters.category
            
            # Price range filters
            if filters.min_price is not None:
                conditions.append(Product.price >= filters.min_price)
                filters_applied['min_price'] = filters.min_price
            
            if filters.max_price is not None:
                conditions.append(Product.price <= filters.max_price)
                filters_applied['max_price'] = filters.max_price
            
            # Availability filter
            if filters.availability is not None:
                conditions.append(Product.availability == filters.availability)
                filters_applied['availability'] = filters.availability
            
            # EAN filter
            if filters.ean:
                conditions.append(Product.ean == filters.ean)
                filters_applied['ean'] = filters.ean
            
            # MPN filter
            if filters.mpn:
                conditions.append(Product.mpn == filters.mpn)
                filters_applied['mpn'] = filters.mpn
            
            # Shop filter
            if filters.shop:
                shop_query = select(Shop.id).where(
                    func.lower(Shop.name).contains(filters.shop.lower())
                )
                shop_result = await self.db.execute(shop_query)
                shop_ids = [row[0] for row in shop_result]
                if shop_ids:
                    conditions.append(Product.shop_id.in_(shop_ids))
                    filters_applied['shop'] = filters.shop
            
            # Variant-based filters (color, size)
            if filters.color or filters.size:
                variant_conditions = []
                if filters.color:
                    variant_conditions.append(
                        func.lower(ProductVariant.color).contains(filters.color.lower())
                    )
                    filters_applied['color'] = filters.color
                
                if filters.size:
                    variant_conditions.append(
                        func.lower(ProductVariant.size).contains(filters.size.lower())
                    )
                    filters_applied['size'] = filters.size
                
                if variant_conditions:
                    variant_query = select(ProductVariant.product_id).where(
                        and_(*variant_conditions)
                    )
                    variant_result = await self.db.execute(variant_query)
                    product_ids = [row[0] for row in variant_result]
                    if product_ids:
                        conditions.append(Product.id.in_(product_ids))
            
            # Apply all conditions
            if conditions:
                query = query.where(and_(*conditions))
            
            # Get total count
            count_query = select(func.count(Product.id))
            if conditions:
                count_query = count_query.where(and_(*conditions))
            
            total_result = await self.db.execute(count_query)
            total = total_result.scalar() or 0
            
            # Apply pagination
            offset = (page - 1) * per_page
            query = query.offset(offset).limit(per_page)
            
            # Order by relevance (availability first, then price)
            query = query.order_by(
                Product.availability.desc(),
                Product.price.asc()
            )
            
            # Execute query
            result = await self.db.execute(query)
            products = result.scalars().all()
            
            # Calculate pagination info
            total_pages = (total + per_page - 1) // per_page
            execution_time = (time.time() - start_time) * 1000  # Convert to milliseconds
            
            return SearchResponse(
                products=[ProductSchema.from_orm(product) for product in products],
                total=total,
                page=page,
                per_page=per_page,
                total_pages=total_pages,
                filters_applied=filters_applied,
                execution_time_ms=round(execution_time, 2)
            )
            
        except Exception as e:
            logger.error(f"Search error: {e}")
            execution_time = (time.time() - start_time) * 1000
            return SearchResponse(
                products=[],
                total=0,
                page=page,
                per_page=per_page,
                total_pages=0,
                filters_applied=filters_applied,
                execution_time_ms=round(execution_time, 2)
            )
    
    async def get_product_by_ean(self, ean: str) -> Optional[ProductSchema]:
        """Get product by EAN code"""
        try:
            query = select(Product).options(
                selectinload(Product.shop),
                selectinload(Product.brand),
                selectinload(Product.category),
                selectinload(Product.variants)
            ).where(Product.ean == ean)
            
            result = await self.db.execute(query)
            product = result.scalar_one_or_none()
            
            if product:
                return ProductSchema.from_orm(product)
            return None
            
        except Exception as e:
            logger.error(f"Error getting product by EAN {ean}: {e}")
            return None
    
    async def get_search_suggestions(self, query: str, limit: int = 10) -> List[str]:
        """Get search suggestions based on query"""
        try:
            # Search in product titles and brands
            suggestions = []
            
            # Title suggestions
            title_query = select(Product.title).where(
                func.lower(Product.title).contains(query.lower())
            ).limit(limit // 2)
            
            title_result = await self.db.execute(title_query)
            titles = [row[0] for row in title_result]
            suggestions.extend(titles)
            
            # Brand suggestions
            brand_query = select(Brand.name).where(
                func.lower(Brand.name).contains(query.lower())
            ).limit(limit // 2)
            
            brand_result = await self.db.execute(brand_query)
            brands = [row[0] for row in brand_result]
            suggestions.extend(brands)
            
            # Remove duplicates and limit
            unique_suggestions = list(set(suggestions))[:limit]
            return unique_suggestions
            
        except Exception as e:
            logger.error(f"Error getting search suggestions: {e}")
            return []
    
    async def get_facets(self, filters: SearchFilters) -> Dict[str, List[Dict[str, Any]]]:
        """Get facets for search results"""
        try:
            facets = {}
            
            # Brand facets
            brand_query = select(
                Brand.name,
                func.count(Product.id).label('count')
            ).join(Product).group_by(Brand.name).order_by(func.count(Product.id).desc()).limit(20)
            
            brand_result = await self.db.execute(brand_query)
            facets['brands'] = [
                {'name': row[0], 'count': row[1]} 
                for row in brand_result
            ]
            
            # Category facets
            category_query = select(
                Category.name,
                func.count(Product.id).label('count')
            ).join(Product).group_by(Category.name).order_by(func.count(Product.id).desc()).limit(20)
            
            category_result = await self.db.execute(category_query)
            facets['categories'] = [
                {'name': row[0], 'count': row[1]} 
                for row in category_result
            ]
            
            # Price ranges
            price_query = select(
                func.min(Product.price).label('min_price'),
                func.max(Product.price).label('max_price'),
                func.avg(Product.price).label('avg_price')
            ).where(Product.price.is_not(None))
            
            price_result = await self.db.execute(price_query)
            price_stats = price_result.first()
            
            if price_stats and price_stats[0] is not None:
                facets['price_ranges'] = [
                    {'range': f"0-{price_stats[2]:.0f}", 'label': f"Under €{price_stats[2]:.0f}"},
                    {'range': f"{price_stats[2]:.0f}-{price_stats[1]:.0f}", 'label': f"€{price_stats[2]:.0f} - €{price_stats[1]:.0f}"},
                    {'range': f"{price_stats[1]:.0f}+", 'label': f"Over €{price_stats[1]:.0f}"}
                ]
            
            return facets
            
        except Exception as e:
            logger.error(f"Error getting facets: {e}")
            return {}
    
    async def search_categories(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search categories by name"""
        try:
            stmt = select(Category.name, func.count(Product.id).label('count')).join(
                Product, Category.id == Product.category_id
            ).where(
                Category.name.ilike(f"%{query}%")
            ).group_by(Category.name).order_by(
                func.count(Product.id).desc()
            ).limit(limit)
            
            result = await self.db.execute(stmt)
            categories = []
            
            for row in result.fetchall():
                categories.append({
                    "name": row.name,
                    "count": row.count
                })
            
            return categories
            
        except Exception as e:
            logger.error(f"Error searching categories: {e}")
            return []
