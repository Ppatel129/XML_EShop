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
    
    async def search_products_aggregated(
        self,
        filters: SearchFilters,
        page: int = 1,
        per_page: int = 50,
        sort: str = 'relevance'
    ) -> SearchResponse:
        """Search products with multi-shop aggregation and enhanced availability info"""
        start_time = time.time()
        
        try:
            # Build query to group products by EAN/title similarity
            query = text("""
                WITH product_groups AS (
                    SELECT 
                        COALESCE(p.ean, '') as group_key,
                        p.title,
                        p.description,
                        p.image_url,
                        p.brand_id,
                        p.category_id,
                        MIN(p.price) as min_price,
                        MAX(p.price) as max_price,
                        AVG(p.price) as avg_price,
                        COUNT(DISTINCT p.shop_id) as shop_count,
                        BOOL_OR(p.availability) as any_available,
                        COUNT(CASE WHEN p.availability = true THEN 1 END) as available_shops,
                        MIN(CASE WHEN p.availability = true THEN p.price END) as best_available_price,
                        ARRAY_AGG(DISTINCT s.name) as shop_names,
                        ARRAY_AGG(DISTINCT p.id) as product_ids,
                        MAX(p.updated_at) as last_updated
                    FROM products p
                    JOIN shops s ON p.shop_id = s.id
                    LEFT JOIN brands b ON p.brand_id = b.id
                    LEFT JOIN categories c ON p.category_id = c.id
                    WHERE 1=1
                    GROUP BY COALESCE(p.ean, ''), p.title, p.description, p.image_url, p.brand_id, p.category_id
                    HAVING COUNT(*) > 0
                )
                SELECT * FROM product_groups
                ORDER BY 
                    CASE WHEN :sort = 'price_asc' THEN min_price END ASC,
                    CASE WHEN :sort = 'price_desc' THEN min_price END DESC,
                    CASE WHEN :sort = 'availability' THEN any_available END DESC,
                    CASE WHEN :sort = 'newest' THEN last_updated END DESC,
                    any_available DESC, min_price ASC
                LIMIT :limit OFFSET :offset
            """)
            
            offset = (page - 1) * per_page
            result = await self.db.execute(query, {"limit": per_page, "offset": offset, "sort": sort})
            product_groups = result.fetchall()
            
            # Convert to response format
            aggregated_products = []
            for group in product_groups:
                # Get brand and category info
                brand_info = None
                if group.brand_id:
                    brand_query = select(Brand).where(Brand.id == group.brand_id)
                    brand_result = await self.db.execute(brand_query)
                    brand_info = brand_result.scalar_one_or_none()
                
                category_info = None
                if group.category_id:
                    cat_query = select(Category).where(Category.id == group.category_id)
                    cat_result = await self.db.execute(cat_query)
                    category_info = cat_result.scalar_one_or_none()
                
                product_data = {
                    "id": group.product_ids[0] if group.product_ids else 0,
                    "title": group.title,
                    "description": group.description,
                    "image_url": group.image_url,
                    "min_price": float(group.min_price) if group.min_price else None,
                    "max_price": float(group.max_price) if group.max_price else None,
                    "avg_price": float(group.avg_price) if group.avg_price else None,
                    "best_available_price": float(group.best_available_price) if group.best_available_price else None,
                    "shop_count": group.shop_count,
                    "available_shops": group.available_shops,
                    "shop_names": list(group.shop_names),
                    "availability": group.any_available,
                    "availability_info": {
                        "available_in_shops": group.available_shops,
                        "total_shops": group.shop_count,
                        "estimated_delivery": "1-3 days" if group.any_available else "3-7 days"
                    },
                    "brand": {"name": brand_info.name} if brand_info else None,
                    "category": {"name": category_info.name} if category_info else None,
                    "last_updated": group.last_updated,
                    "product_ids": list(group.product_ids)
                }
                aggregated_products.append(product_data)
            
            # Get total count
            count_query = text("""
                SELECT COUNT(DISTINCT COALESCE(p.ean, p.title))
                FROM products p
                WHERE 1=1
            """)
            total_result = await self.db.execute(count_query)
            total = total_result.scalar() or 0
            
            execution_time = (time.time() - start_time) * 1000
            total_pages = (total + per_page - 1) // per_page
            
            return {
                "products": aggregated_products,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": total_pages,
                "execution_time_ms": round(execution_time, 2),
                "search_type": "aggregated"
            }
            
        except Exception as e:
            logger.error(f"Aggregated search error: {e}")
            execution_time = (time.time() - start_time) * 1000
            return {
                "products": [],
                "total": 0,
                "page": page,
                "per_page": per_page,
                "total_pages": 0,
                "execution_time_ms": round(execution_time, 2),
                "search_type": "aggregated"
            }

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
    
    async def get_product_by_id(self, product_id: int) -> Optional[ProductSchema]:
        """Get product by ID"""
        try:
            query = select(Product).options(
                selectinload(Product.shop),
                selectinload(Product.brand),
                selectinload(Product.category),
                selectinload(Product.variants)
            ).where(Product.id == product_id)
            
            result = await self.db.execute(query)
            product = result.scalar_one_or_none()
            
            if product:
                return ProductSchema.from_orm(product)
            return None
            
        except Exception as e:
            logger.error(f"Error getting product by ID {product_id}: {e}")
            return None

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
        """Enhanced category search with product aggregation"""
        try:
            if not query:
                # Return top categories if no query
                stmt = select(
                    Category.name, 
                    Category.path,
                    func.count(Product.id).label('total_products'),
                    func.count(func.distinct(func.coalesce(Product.ean, Product.title))).label('unique_products')
                ).join(
                    Product, Category.id == Product.category_id
                ).group_by(Category.name, Category.path).order_by(
                    func.count(Product.id).desc()
                ).limit(limit)
            else:
                # Search with relevance scoring
                stmt = select(
                    Category.name,
                    Category.path,
                    func.count(Product.id).label('total_products'),
                    func.count(func.distinct(func.coalesce(Product.ean, Product.title))).label('unique_products'),
                    (func.similarity(Category.name, query) + func.similarity(Category.path, query)).label('relevance')
                ).join(
                    Product, Category.id == Product.category_id
                ).where(
                    or_(
                        Category.name.ilike(f"%{query}%"),
                        Category.path.ilike(f"%{query}%")
                    )
                ).group_by(Category.name, Category.path).order_by(
                    text('relevance DESC'),
                    func.count(Product.id).desc()
                ).limit(limit)
            
            result = await self.db.execute(stmt)
            categories = []
            
            for row in result.fetchall():
                categories.append({
                    "name": row.name,
                    "path": row.path,
                    "total_products": row.total_products,
                    "unique_products": row.unique_products,
                    "type": "category"
                })
            
            return categories
            
        except Exception as e:
            logger.error(f"Error searching categories: {e}")
            return []
