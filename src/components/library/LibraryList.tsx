
import { ThemedView as View } from '../../contexts/AppearanceThemeContext';
import { libraryCategories } from '../../data/libraryCategories';
import { LibraryListItem } from './LibraryListItem';

export const LibraryList = ({
  onSelectCategory,
}: {
  onSelectCategory: (title: string) => void;
}) => (
  <View style={{ marginTop: 8 }}>
    {libraryCategories.map((item, index) => (
      <LibraryListItem
        key={item.id}
        title={item.title}
        icon={item.icon}
        isLast={index === libraryCategories.length - 1}
        onPress={() => onSelectCategory(item.title)}
      />
    ))}
  </View>
);
